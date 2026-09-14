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

function crearNota(casoId, autorId, texto, visibleParaCliente) {
  return db.prepare(`
    INSERT INTO notas (caso_id, autor_id, texto, visible_para_cliente)
    VALUES (?, ?, ?, ?)
  `).run(casoId, autorId, texto, visibleParaCliente ? 1 : 0).lastInsertRowid;
}

function listarNotas(casoId, { soloVisibles } = {}) {
  const sql = `
    SELECT notas.*, usuarios.nombre AS autor_nombre
    FROM notas
    JOIN usuarios ON usuarios.id = notas.autor_id
    WHERE caso_id = ? ${soloVisibles ? 'AND visible_para_cliente = 1' : ''}
    ORDER BY notas.creado_en DESC
  `;
  return db.prepare(sql).all(casoId);
}

function crearRespuestaCliente(casoId, usuarioId, texto) {
  return db.prepare(`
    INSERT INTO respuestas_cliente (caso_id, usuario_id, texto)
    VALUES (?, ?, ?)
  `).run(casoId, usuarioId, texto || null).lastInsertRowid;
}

function listarRespuestas(casoId) {
  return db.prepare(`
    SELECT respuestas_cliente.*, usuarios.nombre AS usuario_nombre
    FROM respuestas_cliente
    JOIN usuarios ON usuarios.id = respuestas_cliente.usuario_id
    WHERE caso_id = ?
    ORDER BY respuestas_cliente.creado_en DESC
  `).all(casoId);
}

function crearDocumento({ casoId, subidoPor, nombreOriginal, nombreArchivo, tipoMime, tamano }) {
  return db.prepare(`
    INSERT INTO documentos (caso_id, subido_por, nombre_original, nombre_archivo, tipo_mime, tamano)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(casoId, subidoPor, nombreOriginal, nombreArchivo, tipoMime, tamano).lastInsertRowid;
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
  crearRespuestaCliente,
  listarRespuestas,
  crearDocumento,
  listarDocumentos,
  obtenerDocumento,
};
