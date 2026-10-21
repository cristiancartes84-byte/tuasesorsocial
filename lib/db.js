const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rut TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    nombre TEXT NOT NULL,
    email TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('cliente', 'trabajador_social')),
    debe_cambiar_password INTEGER NOT NULL DEFAULT 1,
    foto_perfil TEXT,
    telefono TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS casos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo_subsidio TEXT NOT NULL,
    estado_actual TEXT NOT NULL DEFAULT 'Solicitud recibida',
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hitos_historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    hito TEXT NOT NULL,
    creado_por INTEGER NOT NULL REFERENCES usuarios(id),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    autor_id INTEGER NOT NULL REFERENCES usuarios(id),
    texto TEXT NOT NULL,
    visible_para_cliente INTEGER NOT NULL DEFAULT 1,
    requiere_respuesta INTEGER NOT NULL DEFAULT 0,
    requiere_documento INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS respuestas_cliente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
    nota_id INTEGER REFERENCES notas(id) ON DELETE CASCADE,
    texto TEXT,
    visto INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS documentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    subido_por INTEGER NOT NULL REFERENCES usuarios(id),
    nombre_original TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    tipo_mime TEXT NOT NULL,
    tamano INTEGER NOT NULL,
    estado_revision TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_revision IN ('pendiente', 'aprobado', 'rechazado')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS solicitudes_documento (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caso_id INTEGER NOT NULL REFERENCES casos(id) ON DELETE CASCADE,
    nota_id INTEGER REFERENCES notas(id) ON DELETE CASCADE,
    tipo_id TEXT NOT NULL,
    tipo_label TEXT NOT NULL,
    cantidad_requerida INTEGER NOT NULL DEFAULT 1,
    estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completada')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Bloques de disponibilidad semanal recurrente de la trabajadora social
  -- (ej. lunes 09:00-13:00). Las horas se guardan en hora de Santiago, no UTC.
  CREATE TABLE IF NOT EXISTS disponibilidad_horario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
    hora_inicio TEXT NOT NULL,
    hora_fin TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    caso_id INTEGER REFERENCES casos(id) ON DELETE CASCADE,
    fecha_inicio TEXT NOT NULL,
    fecha_fin TEXT NOT NULL,
    duracion_minutos INTEGER NOT NULL,
    estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'cancelada')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Agenda con abono del 50%: la tabla "citas" original solo permitía los
// estados confirmada/cancelada. SQLite no permite modificar un CHECK, así que
// se reconstruye la tabla (una sola vez) conservando las citas existentes,
// que quedan como confirmadas y sin pago requerido.
const columnasCitas = db.prepare(`PRAGMA table_info(citas)`).all().map((c) => c.name);
if (!columnasCitas.includes('motivo')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;
    CREATE TABLE citas_nueva (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      caso_id INTEGER REFERENCES casos(id) ON DELETE CASCADE,
      fecha_inicio TEXT NOT NULL,
      fecha_fin TEXT NOT NULL,
      duracion_minutos INTEGER NOT NULL,
      estado TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('pendiente_pago', 'confirmada', 'cancelada', 'expirada')),
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      motivo TEXT,
      monto_total INTEGER NOT NULL DEFAULT 0,
      monto_reserva INTEGER NOT NULL DEFAULT 0,
      pago_estado TEXT NOT NULL DEFAULT 'no_requerido' CHECK (pago_estado IN ('no_requerido', 'pendiente', 'informado', 'recibido')),
      pago_informado_en TEXT,
      pago_confirmado_en TEXT,
      expira_en TEXT
    );
    INSERT INTO citas_nueva (id, usuario_id, caso_id, fecha_inicio, fecha_fin, duracion_minutos, estado, creado_en)
      SELECT id, usuario_id, caso_id, fecha_inicio, fecha_fin, duracion_minutos, estado, creado_en FROM citas;
    DROP TABLE citas;
    ALTER TABLE citas_nueva RENAME TO citas;
    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
}

// Servicio elegido por el cliente al reservar (el "motivo" pasa a ser el
// detalle opcional en texto libre).
if (!db.prepare(`PRAGMA table_info(citas)`).all().some((c) => c.name === 'servicio')) {
  db.exec(`ALTER TABLE citas ADD COLUMN servicio TEXT`);
}

// Servicios agendables en línea, definidos por la trabajadora social: cuáles
// se pueden reservar, si exigen abono previo del 50%, su valor y duración.
db.exec(`
  CREATE TABLE IF NOT EXISTS servicios_agenda (
    servicio TEXT PRIMARY KEY,
    activo INTEGER NOT NULL DEFAULT 0,
    requiere_abono INTEGER NOT NULL DEFAULT 1,
    precio INTEGER NOT NULL DEFAULT 0,
    duracion_minutos INTEGER NOT NULL DEFAULT 45
  );
`);

// Ajustes editables desde el panel (datos de transferencia y tarifas).
db.exec(`
  CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL DEFAULT ''
  );
`);

// Compatibilidad: antes había solo dos tarifas globales (sesión estándar e
// Informes Sociales). Si ya estaban guardadas y todavía no hay servicios
// configurados, se convierten en la configuración inicial por servicio.
if (db.prepare(`SELECT COUNT(*) AS c FROM servicios_agenda`).get().c === 0) {
  const tarifa = (clave) => {
    const fila = db.prepare(`SELECT valor FROM configuracion WHERE clave = ?`).get(clave);
    return fila ? parseInt(fila.valor, 10) || 0 : 0;
  };
  const precioSesion = tarifa('precio_sesion');
  const precioInforme = tarifa('precio_informe');
  if (precioSesion > 0 || precioInforme > 0) {
    const { TIPOS_SUBSIDIO } = require('./hitos');
    const ins = db.prepare(`INSERT OR IGNORE INTO servicios_agenda (servicio, activo, requiere_abono, precio, duracion_minutos) VALUES (?, 1, 1, ?, ?)`);
    TIPOS_SUBSIDIO.forEach((t) => {
      const nombre = t === 'Otro' ? 'Otra consulta' : t;
      const esInforme = nombre === 'Informes Sociales';
      const precio = esInforme ? precioInforme : precioSesion;
      if (precio > 0) ins.run(nombre, precio, esInforme ? 120 : 45);
    });
  }
}

// Migraciones simples para bases de datos creadas antes de agregar estas columnas.
const columnasNotas = db.prepare(`PRAGMA table_info(notas)`).all().map((c) => c.name);
if (!columnasNotas.includes('requiere_respuesta')) {
  db.exec(`ALTER TABLE notas ADD COLUMN requiere_respuesta INTEGER NOT NULL DEFAULT 0`);
}
if (!columnasNotas.includes('requiere_documento')) {
  db.exec(`ALTER TABLE notas ADD COLUMN requiere_documento INTEGER NOT NULL DEFAULT 0`);
}

const columnasDocumentos = db.prepare(`PRAGMA table_info(documentos)`).all().map((c) => c.name);
if (!columnasDocumentos.includes('solicitud_id')) {
  db.exec(`ALTER TABLE documentos ADD COLUMN solicitud_id INTEGER REFERENCES solicitudes_documento(id)`);
}
if (!columnasDocumentos.includes('numero_slot')) {
  db.exec(`ALTER TABLE documentos ADD COLUMN numero_slot INTEGER`);
}
if (!columnasDocumentos.includes('estado_revision')) {
  db.exec(`ALTER TABLE documentos ADD COLUMN estado_revision TEXT NOT NULL DEFAULT 'pendiente'`);
}

const columnasRespuestas = db.prepare(`PRAGMA table_info(respuestas_cliente)`).all().map((c) => c.name);
if (!columnasRespuestas.includes('nota_id')) {
  db.exec(`ALTER TABLE respuestas_cliente ADD COLUMN nota_id INTEGER REFERENCES notas(id)`);
}
if (!columnasRespuestas.includes('visto')) {
  db.exec(`ALTER TABLE respuestas_cliente ADD COLUMN visto INTEGER NOT NULL DEFAULT 0`);
}

const columnasUsuarios = db.prepare(`PRAGMA table_info(usuarios)`).all().map((c) => c.name);
if (!columnasUsuarios.includes('foto_perfil')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN foto_perfil TEXT`);
}
if (!columnasUsuarios.includes('ultima_actividad')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN ultima_actividad TEXT`);
}
if (!columnasUsuarios.includes('telefono')) {
  db.exec(`ALTER TABLE usuarios ADD COLUMN telefono TEXT`);
}

module.exports = db;
