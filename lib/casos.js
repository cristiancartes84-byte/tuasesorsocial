const db = require('./db');

function listarCasosConCliente() {
  return db.prepare(`
    SELECT casos.*, usuarios.nombre AS cliente_nombre, usuarios.rut AS cliente_rut
    FROM casos
    JOIN usuarios ON usuarios.id = casos.usuario_id
    ORDER BY casos.creado_en DESC
  `).all();
}

function listarClientes() {
  return db.prepare(`SELECT id, rut, nombre, email FROM usuarios WHERE rol = 'cliente' ORDER BY nombre`).all();
}

function crearCaso({ usuarioId, tipoSubsidio, creadoPor }) {
  const estadoInicial = 'Solicitud recibida';
  const info = db.prepare(`
    INSERT INTO casos (usuario_id, tipo_subsidio, estado_actual)
    VALUES (?, ?, ?)
  `).run(usuarioId, tipoSubsidio, estadoInicial);

  db.prepare(`
    INSERT INTO hitos_historial (caso_id, hito, creado_por)
    VALUES (?, ?, ?)
  `).run(info.lastInsertRowid, estadoInicial, creadoPor);

  return info.lastInsertRowid;
}

function obtenerCaso(casoId) {
  return db.prepare(`
    SELECT casos.*, usuarios.nombre AS cliente_nombre, usuarios.rut AS cliente_rut, usuarios.email AS cliente_email
    FROM casos
    JOIN usuarios ON usuarios.id = casos.usuario_id
    WHERE casos.id = ?
  `).get(casoId);
}

function obtenerCasosDeUsuario(usuarioId) {
  return db.prepare(`SELECT * FROM casos WHERE usuario_id = ? ORDER BY creado_en DESC`).all(usuarioId);
}

function actualizarHito(casoId, hito, creadoPor) {
  db.prepare(`UPDATE casos SET estado_actual = ? WHERE id = ?`).run(hito, casoId);
  db.prepare(`
    INSERT INTO hitos_historial (caso_id, hito, creado_por)
    VALUES (?, ?, ?)
  `).run(casoId, hito, creadoPor);
}

function historialHitos(casoId) {
  return db.prepare(`
    SELECT hitos_historial.*, usuarios.nombre AS creado_por_nombre
    FROM hitos_historial
    JOIN usuarios ON usuarios.id = hitos_historial.creado_por
    WHERE caso_id = ?
    ORDER BY hitos_historial.creado_en DESC
  `).all(casoId);
}

function crearNota(casoId, autorId, texto, visibleParaCliente, { requiereRespuesta, tieneSolicitudDocumento } = {}) {
  return db.prepare(`
    INSERT INTO notas (caso_id, autor_id, texto, visible_para_cliente, requiere_respuesta, requiere_documento)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(casoId, autorId, texto, visibleParaCliente ? 1 : 0, requiereRespuesta ? 1 : 0, tieneSolicitudDocumento ? 1 : 0).lastInsertRowid;
}

function crearSolicitudDocumento({ casoId, notaId, tipoDocumento }) {
  return db.prepare(`
    INSERT INTO solicitudes_documento (caso_id, nota_id, tipo_id, tipo_label, cantidad_requerida)
    VALUES (?, ?, ?, ?, ?)
  `).run(casoId, notaId || null, tipoDocumento.id, tipoDocumento.label, tipoDocumento.cantidad).lastInsertRowid;
}

function listarSolicitudesDeCaso(casoId) {
  const solicitudes = db.prepare(`
    SELECT * FROM solicitudes_documento WHERE caso_id = ? ORDER BY creado_en DESC
  `).all(casoId);

  return solicitudes.map((solicitud) => ({
    ...solicitud,
    documentos: db.prepare(`
      SELECT documentos.*, usuarios.nombre AS subido_por_nombre
      FROM documentos
      JOIN usuarios ON usuarios.id = documentos.subido_por
      WHERE solicitud_id = ?
      ORDER BY numero_slot ASC
    `).all(solicitud.id),
  }));
}

function obtenerSolicitud(solicitudId) {
  return db.prepare(`SELECT * FROM solicitudes_documento WHERE id = ?`).get(solicitudId);
}

function contarDocumentosDeSolicitud(solicitudId) {
  return db.prepare(`SELECT COUNT(*) AS total FROM documentos WHERE solicitud_id = ?`).get(solicitudId).total;
}

function marcarSolicitudCompletada(solicitudId) {
  db.prepare(`UPDATE solicitudes_documento SET estado = 'completada' WHERE id = ?`).run(solicitudId);
}

function eliminarSolicitud(solicitudId) {
  db.prepare(`DELETE FROM solicitudes_documento WHERE id = ?`).run(solicitudId);
}

function listarNotas(casoId, { soloVisibles } = {}) {
  const sql = `
    SELECT notas.*, usuarios.nombre AS autor_nombre
    FROM notas
    JOIN usuarios ON usuarios.id = notas.autor_id
    WHERE caso_id = ? ${soloVisibles ? 'AND visible_para_cliente = 1' : ''}
    ORDER BY notas.creado_en DESC
  `;
  const notas = db.prepare(sql).all(casoId);
  return notas.map((nota) => ({
    ...nota,
    respuestas: db.prepare(`
      SELECT respuestas_cliente.*, usuarios.nombre AS usuario_nombre
      FROM respuestas_cliente
      JOIN usuarios ON usuarios.id = respuestas_cliente.usuario_id
      WHERE nota_id = ?
      ORDER BY respuestas_cliente.creado_en ASC
    `).all(nota.id),
  }));
}

function crearRespuestaCliente(casoId, usuarioId, texto, notaId) {
  return db.prepare(`
    INSERT INTO respuestas_cliente (caso_id, usuario_id, nota_id, texto)
    VALUES (?, ?, ?, ?)
  `).run(casoId, usuarioId, notaId || null, texto || null).lastInsertRowid;
}

// Respuestas del cliente que no responden a ninguna nota puntual (comentarios
// generales sobre el caso).
function listarRespuestasGenerales(casoId) {
  return db.prepare(`
    SELECT respuestas_cliente.*, usuarios.nombre AS usuario_nombre
    FROM respuestas_cliente
    JOIN usuarios ON usuarios.id = respuestas_cliente.usuario_id
    WHERE caso_id = ? AND nota_id IS NULL
    ORDER BY respuestas_cliente.creado_en DESC
  `).all(casoId);
}

function obtenerNota(notaId) {
  return db.prepare(`SELECT * FROM notas WHERE id = ?`).get(notaId);
}

function crearDocumento({ casoId, subidoPor, nombreOriginal, nombreArchivo, tipoMime, tamano, solicitudId, numeroSlot }) {
  return db.prepare(`
    INSERT INTO documentos (caso_id, subido_por, nombre_original, nombre_archivo, tipo_mime, tamano, solicitud_id, numero_slot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(casoId, subidoPor, nombreOriginal, nombreArchivo, tipoMime, tamano, solicitudId || null, numeroSlot || null).lastInsertRowid;
}

function listarDocumentos(casoId) {
  return db.prepare(`
    SELECT documentos.*, usuarios.nombre AS subido_por_nombre
    FROM documentos
    JOIN usuarios ON usuarios.id = documentos.subido_por
    WHERE caso_id = ?
    ORDER BY documentos.creado_en DESC
  `).all(casoId);
}

function obtenerDocumento(documentoId) {
  return db.prepare(`SELECT * FROM documentos WHERE id = ?`).get(documentoId);
}

function listarTrabajadoresSociales() {
  return db.prepare(`SELECT id, nombre, email FROM usuarios WHERE rol = 'trabajador_social'`).all();
}

module.exports = {
  listarCasosConCliente,
  listarClientes,
  crearCaso,
  obtenerCaso,
  obtenerCasosDeUsuario,
  actualizarHito,
  historialHitos,
  crearNota,
  listarNotas,
  obtenerNota,
  crearRespuestaCliente,
  listarRespuestasGenerales,
  crearDocumento,
  listarDocumentos,
  obtenerDocumento,
  listarTrabajadoresSociales,
  crearSolicitudDocumento,
  listarSolicitudesDeCaso,
  obtenerSolicitud,
  contarDocumentosDeSolicitud,
  marcarSolicitudCompletada,
  eliminarSolicitud,
};
