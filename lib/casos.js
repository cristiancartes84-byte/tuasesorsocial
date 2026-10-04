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

function listarClientesConCasos() {
  return db.prepare(`
    SELECT usuarios.id, usuarios.rut, usuarios.nombre, usuarios.email, usuarios.creado_en,
      (SELECT COUNT(*) FROM casos WHERE casos.usuario_id = usuarios.id) AS total_casos
    FROM usuarios
    WHERE rol = 'cliente'
    ORDER BY usuarios.nombre
  `).all();
}

function obtenerCliente(usuarioId) {
  return db.prepare(`SELECT id, rut, nombre, email FROM usuarios WHERE id = ? AND rol = 'cliente'`).get(usuarioId);
}

function actualizarCliente(usuarioId, { nombre, email }) {
  db.prepare(`UPDATE usuarios SET nombre = ?, email = ? WHERE id = ? AND rol = 'cliente'`).run(nombre, email, usuarioId);
}

// Solo permite eliminar un cliente si no tiene ningún caso asociado, para
// no perder historial de gestiones por error.
function eliminarCliente(usuarioId) {
  const totalCasos = obtenerCasosDeUsuario(usuarioId).length;
  if (totalCasos > 0) return false;
  db.prepare(`DELETE FROM usuarios WHERE id = ? AND rol = 'cliente'`).run(usuarioId);
  return true;
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

// Elimina un registro del historial de hitos (ej. si el trabajador social
// se equivocó al marcarlo). Si era el hito más reciente, el estado actual
// del caso vuelve al hito anterior en el historial. No permite dejar el
// historial vacío.
function eliminarHito(hitoId, casoId) {
  const historial = historialHitos(casoId);
  if (historial.length <= 1) return false;

  const esElMasReciente = historial[0].id === Number(hitoId);
  db.prepare(`DELETE FROM hitos_historial WHERE id = ?`).run(hitoId);

  if (esElMasReciente) {
    const restante = historialHitos(casoId);
    db.prepare(`UPDATE casos SET estado_actual = ? WHERE id = ?`).run(restante[0].hito, casoId);
  }

  return true;
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

// Un documento rechazado no cuenta como "recibido": libera su cupo para
// que el cliente pueda volver a subirlo.
function contarDocumentosDeSolicitud(solicitudId) {
  return db.prepare(`
    SELECT COUNT(*) AS total FROM documentos WHERE solicitud_id = ? AND estado_revision != 'rechazado'
  `).get(solicitudId).total;
}

function marcarSolicitudCompletada(solicitudId) {
  db.prepare(`UPDATE solicitudes_documento SET estado = 'completada' WHERE id = ?`).run(solicitudId);
}

// La trabajadora social marca un documento como correcto o como que debe
// volver a subirse. Si se rechaza un documento que ya estaba contando para
// completar la solicitud, esta vuelve a quedar pendiente automáticamente.
function actualizarEstadoDocumento(documentoId, estadoRevision) {
  db.prepare(`UPDATE documentos SET estado_revision = ? WHERE id = ?`).run(estadoRevision, documentoId);

  const documento = obtenerDocumento(documentoId);
  if (!documento || !documento.solicitud_id) return;

  const solicitud = obtenerSolicitud(documento.solicitud_id);
  const validos = contarDocumentosDeSolicitud(documento.solicitud_id);

  if (validos >= solicitud.cantidad_requerida) {
    marcarSolicitudCompletada(documento.solicitud_id);
  } else if (solicitud.estado === 'completada') {
    db.prepare(`UPDATE solicitudes_documento SET estado = 'pendiente' WHERE id = ?`).run(documento.solicitud_id);
  }
}

function eliminarSolicitud(solicitudId) {
  db.prepare(`DELETE FROM solicitudes_documento WHERE id = ?`).run(solicitudId);
}

function listarNotas(casoId, { soloVisibles } = {}) {
  const sql = `
    SELECT notas.*, usuarios.nombre AS autor_nombre, usuarios.foto_perfil AS autor_foto
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

// Preguntas sin responder y documentos pendientes, a través de todos los
// casos del cliente — para mostrar un aviso de "necesita tu atención" en
// su dashboard sin que tenga que entrar a cada gestión a revisar.
function obtenerPendientesDeUsuario(usuarioId) {
  const pendientes = [];

  obtenerCasosDeUsuario(usuarioId).forEach((caso) => {
    listarNotas(caso.id, { soloVisibles: true }).forEach((nota) => {
      if (nota.requiere_respuesta && nota.respuestas.length === 0) {
        pendientes.push({
          tipo: 'respuesta',
          casoId: caso.id,
          tipoSubsidio: caso.tipo_subsidio,
          texto: nota.texto,
        });
      }
    });

    listarSolicitudesDeCaso(caso.id).forEach((solicitud) => {
      if (solicitud.estado === 'pendiente') {
        const validos = solicitud.documentos.filter((d) => d.estado_revision !== 'rechazado').length;
        pendientes.push({
          tipo: 'documento',
          casoId: caso.id,
          tipoSubsidio: caso.tipo_subsidio,
          texto: solicitud.tipo_label,
          faltan: solicitud.cantidad_requerida - validos,
        });
      }
    });
  });

  return pendientes;
}

function marcarRespuestasComoVistas(casoId) {
  db.prepare(`UPDATE respuestas_cliente SET visto = 1 WHERE caso_id = ?`).run(casoId);
}

// Documentos pendientes de revisión y respuestas de clientes todavía no
// vistas, a través de todos los casos — para la campana de notificaciones
// del panel de la trabajadora social.
function contarNotificacionesAdmin() {
  const documentosPendientes = db.prepare(`
    SELECT documentos.id, documentos.caso_id, documentos.nombre_original, documentos.creado_en,
      casos.tipo_subsidio, usuarios.nombre AS cliente_nombre
    FROM documentos
    JOIN casos ON casos.id = documentos.caso_id
    JOIN usuarios ON usuarios.id = casos.usuario_id
    WHERE documentos.estado_revision = 'pendiente'
    ORDER BY documentos.creado_en DESC
  `).all();

  const respuestasNoVistas = db.prepare(`
    SELECT respuestas_cliente.id, respuestas_cliente.caso_id, respuestas_cliente.texto, respuestas_cliente.creado_en,
      casos.tipo_subsidio, usuarios.nombre AS cliente_nombre
    FROM respuestas_cliente
    JOIN casos ON casos.id = respuestas_cliente.caso_id
    JOIN usuarios ON usuarios.id = casos.usuario_id
    WHERE respuestas_cliente.visto = 0
    ORDER BY respuestas_cliente.creado_en DESC
  `).all();

  const items = [
    ...documentosPendientes.map((d) => ({
      tipo: 'documento',
      casoId: d.caso_id,
      clienteNombre: d.cliente_nombre,
      tipoSubsidio: d.tipo_subsidio,
      detalle: `Subió: ${d.nombre_original}`,
    })),
    ...respuestasNoVistas.map((r) => ({
      tipo: 'respuesta',
      casoId: r.caso_id,
      clienteNombre: r.cliente_nombre,
      tipoSubsidio: r.tipo_subsidio,
      detalle: `Respondió: ${(r.texto || '').slice(0, 60)}`,
    })),
  ];

  return { total: items.length, items };
}

module.exports = {
  listarCasosConCliente,
  listarClientes,
  listarClientesConCasos,
  obtenerCliente,
  actualizarCliente,
  eliminarCliente,
  crearCaso,
  obtenerCaso,
  obtenerCasosDeUsuario,
  actualizarHito,
  eliminarHito,
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
  actualizarEstadoDocumento,
  eliminarSolicitud,
  obtenerPendientesDeUsuario,
  marcarRespuestasComoVistas,
  contarNotificacionesAdmin,
};
