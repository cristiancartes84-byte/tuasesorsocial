const db = require('./db');
const { construirFechaSantiago, hoyEnSantiago, aSqlite } = require('./fechas');

const DIAS_ADELANTE = 21;
const MINUTOS_ANTICIPACION_MINIMA = 120;

function duracionParaTipo(tipoSubsidio) {
  return tipoSubsidio === 'Informes Sociales' ? 120 : 45;
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

  const citasFuturas = db.prepare(`
    SELECT fecha_inicio, fecha_fin FROM citas
    WHERE estado = 'confirmada' AND fecha_fin > datetime('now')
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
      porDia.push({ fecha: new Date(hoyBase.getFullYear(), hoyBase.getMonth(), hoyBase.getDate() + d), slots: slotsDelDia });
    }
  }
  return porDia;
}

// Devuelve { ok:true, citaId } o { ok:false, error }. Vuelve a chequear el
// cruce con otras citas justo antes de insertar, por si dos personas
// intentan reservar el mismo horario casi al mismo tiempo.
function crearCita({ usuarioId, casoId, inicio, fin, duracionMinutos }) {
  const inicioSql = aSqlite(inicio);
  const finSql = aSqlite(fin);
  const conflicto = db.prepare(`
    SELECT COUNT(*) AS c FROM citas
    WHERE estado = 'confirmada' AND fecha_inicio < ? AND fecha_fin > ?
  `).get(finSql, inicioSql);
  if (conflicto.c > 0) {
    return { ok: false, error: 'Ese horario ya no está disponible, elige otro.' };
  }
  const info = db.prepare(`
    INSERT INTO citas (usuario_id, caso_id, fecha_inicio, fecha_fin, duracion_minutos)
    VALUES (?, ?, ?, ?, ?)
  `).run(usuarioId, casoId || null, inicioSql, finSql, duracionMinutos);
  return { ok: true, citaId: info.lastInsertRowid };
}

function obtenerCita(id) {
  return db.prepare(`SELECT * FROM citas WHERE id = ?`).get(id);
}

function listarCitasDeUsuario(usuarioId) {
  return db.prepare(`
    SELECT citas.*, casos.tipo_subsidio
    FROM citas LEFT JOIN casos ON casos.id = citas.caso_id
    WHERE citas.usuario_id = ? AND citas.estado = 'confirmada' AND citas.fecha_fin > datetime('now')
    ORDER BY citas.fecha_inicio ASC
  `).all(usuarioId);
}

function listarCitasFuturasAdmin() {
  return db.prepare(`
    SELECT citas.*, usuarios.nombre AS cliente_nombre, usuarios.rut AS cliente_rut, casos.tipo_subsidio
    FROM citas
    JOIN usuarios ON usuarios.id = citas.usuario_id
    LEFT JOIN casos ON casos.id = citas.caso_id
    WHERE citas.estado = 'confirmada' AND citas.fecha_fin > datetime('now')
    ORDER BY citas.fecha_inicio ASC
  `).all();
}

function cancelarCita(id) {
  db.prepare(`UPDATE citas SET estado = 'cancelada' WHERE id = ?`).run(id);
}

module.exports = {
  duracionParaTipo,
  obtenerDisponibilidad,
  agregarBloqueDisponibilidad,
  eliminarBloqueDisponibilidad,
  generarSlotsDisponibles,
  crearCita,
  obtenerCita,
  listarCitasDeUsuario,
  listarCitasFuturasAdmin,
  cancelarCita,
};
