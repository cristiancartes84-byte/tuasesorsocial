const db = require('./db');
const { TIPOS_SUBSIDIO } = require('./hitos');
const { construirFechaSantiago, hoyEnSantiago, aSqlite } = require('./fechas');

const DIAS_ADELANTE = 21;
const MINUTOS_ANTICIPACION_MINIMA = 120;

// Una hora sin pagar queda retenida este tiempo; si no se informa el pago, se libera.
const MINUTOS_RETENCION_PAGO = 15;
const PORCENTAJE_RESERVA = 50;

// Citas que bloquean el horario: las confirmadas, y las que esperan pago
// mientras su retención no haya vencido (o el cliente ya informó su
// transferencia y la trabajadora social aún no la revisa).
const SQL_OCUPA_HORARIO = `(
  estado = 'confirmada'
  OR (estado = 'pendiente_pago' AND (pago_estado = 'informado' OR expira_en > datetime('now')))
)`;

const CLAVES_CONFIG = [
  'banco', 'tipo_cuenta', 'numero_cuenta', 'titular', 'rut_titular', 'email_pago',
];

// Servicios que se pueden agendar: los mismos tipos de gestión del sistema.
const SERVICIOS_AGENDA = TIPOS_SUBSIDIO.map((t) => (t === 'Otro' ? 'Otra consulta' : t));
const servicioATipo = (servicio) => (servicio === 'Otra consulta' ? 'Otro' : servicio);

function duracionPorDefecto(servicio) {
  return servicio === 'Informes Sociales' ? 120 : 45;
}

function obtenerConfigPago() {
  const cfg = {};
  CLAVES_CONFIG.forEach((k) => { cfg[k] = ''; });
  db.prepare(`SELECT clave, valor FROM configuracion`).all().forEach((r) => { cfg[r.clave] = r.valor; });
  return cfg;
}

function guardarConfigPago(datos) {
  const stmt = db.prepare(`
    INSERT INTO configuracion (clave, valor) VALUES (?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor
  `);
  const tx = db.transaction(() => {
    CLAVES_CONFIG.forEach((k) => {
      const v = String(datos[k] || '').trim().slice(0, 200);
      stmt.run(k, v);
    });
  });
  tx();
}

// Configuración de cada servicio. Por defecto ninguno está habilitado: la
// trabajadora social decide cuáles se pueden agendar, cuáles exigen abono y
// cuánto valen.
function obtenerServicios() {
  const filas = {};
  db.prepare(`SELECT * FROM servicios_agenda`).all().forEach((r) => { filas[r.servicio] = r; });
  return SERVICIOS_AGENDA.map((nombre) => {
    const r = filas[nombre];
    return {
      nombre,
      activo: !!(r && r.activo),
      requiereAbono: r ? !!r.requiere_abono : true,
      precio: r ? r.precio : 0,
      duracion: r ? r.duracion_minutos : duracionPorDefecto(nombre),
    };
  });
}

function obtenerServicio(nombre) {
  return obtenerServicios().find((s) => s.nombre === nombre) || null;
}

// lista: [{ nombre, activo, requiereAbono, precio, duracion }]
function guardarServicios(lista) {
  const stmt = db.prepare(`
    INSERT INTO servicios_agenda (servicio, activo, requiere_abono, precio, duracion_minutos)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(servicio) DO UPDATE SET activo = excluded.activo, requiere_abono = excluded.requiere_abono,
      precio = excluded.precio, duracion_minutos = excluded.duracion_minutos
  `);
  db.transaction(() => {
    lista.forEach((s) => {
      if (!SERVICIOS_AGENDA.includes(s.nombre)) return;
      stmt.run(s.nombre, s.activo ? 1 : 0, s.requiereAbono ? 1 : 0, Math.max(0, parseInt(s.precio, 10) || 0), Math.min(480, Math.max(15, parseInt(s.duracion, 10) || duracionPorDefecto(s.nombre))));
    });
  })();
}

// Un servicio se puede reservar si la trabajadora social lo habilitó y, cuando
// exige abono, tiene valor y están completos los datos de transferencia.
function reservaHabilitada(servicio, cfg = obtenerConfigPago()) {
  const sv = obtenerServicio(servicio);
  if (!sv || !sv.activo) return false;
  return sv.requiereAbono ? sv.precio > 0 && datosPagoCompletos(cfg) : true;
}

// Los datos de transferencia están completos si hay banco, cuenta y titular.
function datosPagoCompletos(cfg) {
  return !!(cfg.banco && cfg.numero_cuenta && cfg.titular);
}

// Devuelve { total, reserva, requiereAbono, duracion } en pesos. La reserva
// (abono) es el 50% del valor solo si el servicio exige abono previo.
function calcularMontos(servicio) {
  const sv = obtenerServicio(servicio);
  if (!sv) return { total: 0, reserva: 0, requiereAbono: false, duracion: 45 };
  return {
    total: sv.precio,
    reserva: sv.requiereAbono ? Math.round(sv.precio * PORCENTAJE_RESERVA / 100) : 0,
    requiereAbono: sv.requiereAbono,
    duracion: sv.duracion,
  };
}

function expirarPendientes() {
  db.prepare(`
    UPDATE citas SET estado = 'expirada'
    WHERE estado = 'pendiente_pago' AND pago_estado = 'pendiente' AND expira_en <= datetime('now')
  `).run();
}

// "YYYY-MM-DD" de un día calendario (la fecha local del objeto, que aquí solo
// se usa para iterar días, no como instante).
function claveDia(fecha) {
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${fecha.getFullYear()}-${m}-${d}`;
}

function claveHoy() {
  const { anio, mes, dia } = hoyEnSantiago();
  return claveDia(new Date(anio, mes - 1, dia));
}

function obtenerDisponibilidad() {
  return db.prepare(`SELECT * FROM disponibilidad_horario ORDER BY dia_semana, hora_inicio`).all();
}

function agregarBloqueDisponibilidad({ diaSemana, horaInicio, horaFin }) {
  db.prepare(`INSERT INTO disponibilidad_horario (dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?)`)
    .run(diaSemana, horaInicio, horaFin);
}

function eliminarBloqueDisponibilidad(id) {
  db.prepare(`DELETE FROM disponibilidad_horario WHERE id = ?`).run(id);
}

// Genera los horarios disponibles para los próximos DIAS_ADELANTE días, de
// la duración solicitada, agrupados por día. Excluye los ya reservados y
// los que ya pasaron o están demasiado próximos (MINUTOS_ANTICIPACION_MINIMA).
function generarSlotsDisponibles(duracionMinutos) {
  const bloques = obtenerDisponibilidad();
  if (bloques.length === 0) return [];

  const limiteMs = Date.now() + MINUTOS_ANTICIPACION_MINIMA * 60000;
  const { anio, mes, dia } = hoyEnSantiago();
  const hoyBase = new Date(anio, mes - 1, dia); // solo para iterar días calendario

  expirarPendientes();
  const citasFuturas = db.prepare(`
    SELECT fecha_inicio, fecha_fin FROM citas
    WHERE ${SQL_OCUPA_HORARIO} AND fecha_fin > datetime('now')
  `).all().map((c) => ({
    inicio: new Date(c.fecha_inicio.replace(' ', 'T') + 'Z').getTime(),
    fin: new Date(c.fecha_fin.replace(' ', 'T') + 'Z').getTime(),
  }));

  const porDia = [];
  for (let d = 0; d < DIAS_ADELANTE; d++) {
    const fechaDia = new Date(hoyBase);
    fechaDia.setDate(fechaDia.getDate() + d);
    const diaSemana = fechaDia.getDay();
    const bloquesDia = bloques.filter((b) => b.dia_semana === diaSemana);
    if (bloquesDia.length === 0) continue;

    const slotsDelDia = [];
    bloquesDia.forEach((bloque) => {
      const [hIni, mIni] = bloque.hora_inicio.split(':').map(Number);
      const [hFin, mFin] = bloque.hora_fin.split(':').map(Number);
      const y = fechaDia.getFullYear();
      const m = fechaDia.getMonth() + 1;
      const dd = fechaDia.getDate();
      let cursorMs = construirFechaSantiago(y, m, dd, hIni, mIni).getTime();
      const finBloqueMs = construirFechaSantiago(y, m, dd, hFin, mFin).getTime();

      while (cursorMs + duracionMinutos * 60000 <= finBloqueMs) {
        const finMs = cursorMs + duracionMinutos * 60000;
        const disponible = cursorMs >= limiteMs
          && !citasFuturas.some((c) => cursorMs < c.fin && finMs > c.inicio);
        if (disponible) {
          slotsDelDia.push({ inicio: new Date(cursorMs), fin: new Date(finMs) });
        }
        cursorMs = finMs;
      }
    });

    if (slotsDelDia.length > 0) {
      slotsDelDia.sort((a, b) => a.inicio - b.inicio);
      // "fecha" es el mediodía de ese día en Santiago: así, al formatearla en
      // hora de Santiago siempre muestra el día correcto aunque el servidor
      // corra en UTC (a medianoche local caía el día anterior).
      porDia.push({ fecha: construirFechaSantiago(fechaDia.getFullYear(), fechaDia.getMonth() + 1, fechaDia.getDate(), 12, 0), clave: claveDia(fechaDia), slots: slotsDelDia });
    }
  }
  return porDia;
}

// Devuelve { ok:true, citaId, requierePago } o { ok:false, error }. Vuelve a
// chequear el cruce con otras citas justo antes de insertar, por si dos
// personas intentan reservar el mismo horario casi al mismo tiempo. Si el
// horario exige abono (monto > 0) la cita queda "pendiente_pago" y retiene el
// horario durante MINUTOS_RETENCION_PAGO minutos.
function crearCita({ usuarioId, casoId, inicio, fin, duracionMinutos, servicio, motivo, montoTotal, montoReserva }) {
  expirarPendientes();
  const inicioSql = aSqlite(inicio);
  const finSql = aSqlite(fin);
  const conflicto = db.prepare(`
    SELECT COUNT(*) AS c FROM citas
    WHERE ${SQL_OCUPA_HORARIO} AND fecha_inicio < ? AND fecha_fin > ?
  `).get(finSql, inicioSql);
  if (conflicto.c > 0) {
    return { ok: false, error: 'Ese horario ya no está disponible, elige otro.' };
  }
  const requierePago = (montoReserva || 0) > 0;
  const limiteMs = Date.now() + MINUTOS_RETENCION_PAGO * 60000;
  const info = db.prepare(`
    INSERT INTO citas (usuario_id, caso_id, fecha_inicio, fecha_fin, duracion_minutos,
      estado, servicio, motivo, monto_total, monto_reserva, pago_estado, expira_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    usuarioId, casoId || null, inicioSql, finSql, duracionMinutos,
    requierePago ? 'pendiente_pago' : 'confirmada',
    servicio || null,
    motivo || null,
    requierePago ? montoTotal : 0,
    requierePago ? montoReserva : 0,
    requierePago ? 'pendiente' : 'no_requerido',
    requierePago ? aSqlite(new Date(limiteMs)) : null
  );
  return { ok: true, citaId: info.lastInsertRowid, requierePago };
}

function obtenerCita(id) {
  return db.prepare(`SELECT * FROM citas WHERE id = ?`).get(id);
}

function listarCitasDeUsuario(usuarioId) {
  expirarPendientes();
  return db.prepare(`
    SELECT citas.*, casos.tipo_subsidio
    FROM citas LEFT JOIN casos ON casos.id = citas.caso_id
    WHERE citas.usuario_id = ? AND citas.estado IN ('confirmada', 'pendiente_pago') AND citas.fecha_fin > datetime('now')
    ORDER BY citas.fecha_inicio ASC
  `).all(usuarioId);
}

const SELECT_CITA_ADMIN = `
  SELECT citas.*, usuarios.nombre AS cliente_nombre, usuarios.rut AS cliente_rut,
    usuarios.email AS cliente_email, casos.tipo_subsidio
  FROM citas
  JOIN usuarios ON usuarios.id = citas.usuario_id
  LEFT JOIN casos ON casos.id = citas.caso_id
`;

// Citas confirmadas próximas.
function listarCitasFuturasAdmin() {
  return db.prepare(`${SELECT_CITA_ADMIN}
    WHERE citas.estado = 'confirmada' AND citas.fecha_fin > datetime('now')
    ORDER BY citas.fecha_inicio ASC
  `).all();
}

// Reservas que esperan el abono: las que el cliente ya dijo haber pagado
// primero (hay que revisar la cuenta), luego las que aún no pagan.
function listarPagosPendientesAdmin() {
  expirarPendientes();
  return db.prepare(`${SELECT_CITA_ADMIN}
    WHERE citas.estado = 'pendiente_pago' AND citas.fecha_fin > datetime('now')
    ORDER BY (citas.pago_estado = 'informado') DESC, citas.fecha_inicio ASC
  `).all();
}

function contarPagosPorRevisar() {
  expirarPendientes();
  return db.prepare(`
    SELECT COUNT(*) AS c FROM citas
    WHERE estado = 'pendiente_pago' AND pago_estado = 'informado' AND fecha_fin > datetime('now')
  `).get().c;
}

function cancelarCita(id) {
  db.prepare(`UPDATE citas SET estado = 'cancelada' WHERE id = ?`).run(id);
}

// El cliente avisa que ya hizo la transferencia.
function informarPago(id) {
  db.prepare(`
    UPDATE citas SET pago_estado = 'informado', pago_informado_en = datetime('now')
    WHERE id = ? AND estado = 'pendiente_pago' AND pago_estado = 'pendiente'
  `).run(id);
}

// La trabajadora social confirma que recibió el dinero: la hora queda
// confirmada. También sirve para una reserva que venció (el cliente pagó pero
// no alcanzó a avisar), siempre que el horario siga libre.
function confirmarPago(id) {
  const cita = obtenerCita(id);
  if (!cita) return false;
  if (cita.estado === 'expirada') {
    const conflicto = db.prepare(`
      SELECT COUNT(*) AS c FROM citas
      WHERE ${SQL_OCUPA_HORARIO} AND id != ? AND fecha_inicio < ? AND fecha_fin > ?
    `).get(cita.id, cita.fecha_fin, cita.fecha_inicio);
    if (conflicto.c > 0 || cita.fecha_fin <= aSqlite(new Date())) return false;
  } else if (cita.estado !== 'pendiente_pago') {
    return false;
  }
  return db.prepare(`
    UPDATE citas SET estado = 'confirmada', pago_estado = 'recibido', pago_confirmado_en = datetime('now'), expira_en = NULL
    WHERE id = ? AND estado IN ('pendiente_pago', 'expirada')
  `).run(id).changes > 0;
}

// Reservas que vencieron sin avisar pago en las últimas 24 horas (por si el
// cliente sí transfirió y hay que confirmarlas igual).
function listarVencidasRecientesAdmin() {
  expirarPendientes();
  return db.prepare(`${SELECT_CITA_ADMIN}
    WHERE citas.estado = 'expirada' AND citas.fecha_fin > datetime('now') AND citas.expira_en > datetime('now', '-1 day')
    ORDER BY citas.expira_en DESC
  `).all();
}

// Calendario de los próximos días para la trabajadora social: por cada día con
// bloques de disponibilidad, las citas (confirmadas o con pago pendiente) y
// los tramos que siguen libres.
function agendaAdmin(dias = DIAS_ADELANTE) {
  expirarPendientes();
  const bloques = obtenerDisponibilidad();
  const { anio, mes, dia } = hoyEnSantiago();
  const hoyBase = new Date(anio, mes - 1, dia);
  const ahoraMs = Date.now();
  const ocupa = SQL_OCUPA_HORARIO.replace(/\b(estado|pago_estado|expira_en)\b/g, 'citas.$1');
  const citas = db.prepare(`${SELECT_CITA_ADMIN}
    WHERE ${ocupa} AND citas.fecha_fin > datetime('now')
    ORDER BY citas.fecha_inicio
  `).all().map((c) => ({
    ...c,
    ini: new Date(c.fecha_inicio.replace(' ', 'T') + 'Z').getTime(),
    fin: new Date(c.fecha_fin.replace(' ', 'T') + 'Z').getTime(),
  }));

  const salida = [];
  for (let d = 0; d < dias; d++) {
    const fechaDia = new Date(hoyBase);
    fechaDia.setDate(fechaDia.getDate() + d);
    const bloquesDia = bloques.filter((b) => b.dia_semana === fechaDia.getDay());
    if (bloquesDia.length === 0) continue;
    const y = fechaDia.getFullYear();
    const m = fechaDia.getMonth() + 1;
    const dd = fechaDia.getDate();

    const items = [];
    bloquesDia.forEach((bloque) => {
      const [hIni, mIni] = bloque.hora_inicio.split(':').map(Number);
      const [hFin, mFin] = bloque.hora_fin.split(':').map(Number);
      const bIni = Math.max(construirFechaSantiago(y, m, dd, hIni, mIni).getTime(), ahoraMs);
      const bFin = construirFechaSantiago(y, m, dd, hFin, mFin).getTime();
      if (bFin <= bIni) return;
      let cursor = bIni;
      citas.filter((c) => c.ini < bFin && c.fin > bIni).forEach((c) => {
        if (c.ini > cursor) items.push({ tipo: 'libre', inicio: new Date(cursor), fin: new Date(c.ini) });
        items.push({ tipo: 'cita', inicio: new Date(c.ini), fin: new Date(c.fin), cita: c });
        cursor = Math.max(cursor, c.fin);
      });
      if (cursor < bFin) items.push({ tipo: 'libre', inicio: new Date(cursor), fin: new Date(bFin) });
    });
    if (items.length) {
      items.sort((a, b) => a.inicio - b.inicio);
      salida.push({ fecha: construirFechaSantiago(y, m, dd, 12, 0), clave: claveDia(fechaDia), items });
    }
  }
  return salida;
}

module.exports = {
  SERVICIOS_AGENDA,
  servicioATipo,
  obtenerServicios,
  obtenerServicio,
  guardarServicios,
  obtenerDisponibilidad,
  agregarBloqueDisponibilidad,
  eliminarBloqueDisponibilidad,
  generarSlotsDisponibles,
  crearCita,
  obtenerCita,
  listarCitasDeUsuario,
  listarCitasFuturasAdmin,
  cancelarCita,
  informarPago,
  confirmarPago,
  listarPagosPendientesAdmin,
  contarPagosPorRevisar,
  agendaAdmin,
  claveHoy,
  obtenerConfigPago,
  guardarConfigPago,
  datosPagoCompletos,
  calcularMontos,
  MINUTOS_RETENCION_PAGO,
  reservaHabilitada,
  listarVencidasRecientesAdmin,
  PORCENTAJE_RESERVA,
};
