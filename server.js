require('dotenv').config();

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { autenticar, requireRole, generarPasswordTemporal, cambiarPassword, crearUsuario, resetearPassword, obtenerUsuarioPorId, actualizarFotoPerfil, registrarActividad, estaEnLinea, obtenerTrabajadorSocial } = require('./lib/auth');
const rut = require('./lib/rut');
const casos = require('./lib/casos');
const { HITOS, TIPOS_SUBSIDIO } = require('./lib/hitos');
const { TIPOS_DOCUMENTO, obtenerTipoDocumento } = require('./lib/documentos-catalogo');
const { iconoParaTipo } = require('./lib/iconos');
const mailer = require('./lib/mailer');
const { upload, rutaArchivo, uploadFotoPerfil, PERFILES_DIR } = require('./lib/uploads');
const { obtenerQrSitio } = require('./lib/qr');

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás de Traefik/Coolify: necesario para que las cookies "secure" funcionen
app.set('trust proxy', 1);

// Tratar "/ruta" y "/ruta/" como rutas distintas, para que las redirecciones
// 301 sin slash final funcionen correctamente (evita contenido duplicado)
app.set('strict routing', true);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Seguridad y compresión
app.use(helmet({
  contentSecurityPolicy: false, // Permitir inline scripts para animaciones
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiar-en-produccion',
  resave: false,
  saveUninitialized: false,
  // rolling: la expiracion de la cookie se renueva en cada request, no solo
  // al iniciar sesion. Sin esto, maxAge se fija una sola vez al login y la
  // sesion vence a las 8h exactas sin importar que se haya seguido usando
  // el panel activamente -- causaba que cualquier click, tras esas 8h,
  // mandara de vuelta al login aunque la topbar siguiera mostrando el
  // nombre (esa parte de la pagina ya estaba renderizada antes de vencer).
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 horas de inactividad
  },
}));

// Admin (/admin) y portal (/portal) comparten la misma cookie de sesión del
// navegador. Sin esto, tener ambos logueados a la vez (ej. Francis en una
// pestaña y un cliente en otra) rompía: iniciar sesión en una pestaña pisaba
// la sesión de la otra, y al volver a esa pestaña y refrescar, el rol ya no
// coincidía y mandaba de vuelta al login ("cada vez que actualizo me pide
// loguearme"). iniciarSesion() guarda la identidad reemplazada en
// session.otraSesion; aquí, según el prefijo de la URL, se restaura
// automáticamente la identidad correcta antes de que nada más la lea.
app.use((req, res, next) => {
  if (req.session) {
    const rolEsperado = req.path.startsWith('/admin') ? 'trabajador_social'
      : req.path.startsWith('/portal') ? 'cliente'
      : null;
    if (rolEsperado && req.session.usuario && req.session.usuario.rol !== rolEsperado
        && req.session.otraSesion && req.session.otraSesion.rol === rolEsperado) {
      const temp = req.session.usuario;
      req.session.usuario = req.session.otraSesion;
      req.session.otraSesion = temp;
    }
  }
  next();
});

// Marca la actividad reciente del usuario logueado (base del estado "en línea"
// que se muestra en las tarjetas de perfil). Se limita a cada 20s por sesión
// para no escribir en la base en cada request de una misma carga de página.
app.use((req, res, next) => {
  if (req.session && req.session.usuario) {
    const ahora = Date.now();
    if (!req.session.ultimaActividadTs || ahora - req.session.ultimaActividadTs > 20000) {
      registrarActividad(req.session.usuario.id);
      req.session.ultimaActividadTs = ahora;
    }
  }
  next();
});

app.post('/api/heartbeat', (req, res) => {
  res.sendStatus(204);
});

// Datos para la barra superior del panel (campana de notificaciones, tarjeta
// de perfil con QR): se calculan una vez por request, disponibles en todas
// las vistas admin/* sin repetir la consulta en cada ruta.
app.use('/admin', async (req, res, next) => {
  if (req.session.usuario && req.session.usuario.rol === 'trabajador_social') {
    res.locals.notificacionesAdmin = casos.contarNotificacionesAdmin();
    res.locals.cuentaActual = obtenerUsuarioPorId(req.session.usuario.id);
    res.locals.qrSitio = await obtenerQrSitio();
  }
  next();
});

// Tarjeta con los datos de la trabajadora social (foto, nombre y si está en
// línea) visible para el cliente en el portal.
app.use('/portal', (req, res, next) => {
  if (req.session.usuario && req.session.usuario.rol === 'cliente') {
    const trabajadorSocial = obtenerTrabajadorSocial();
    if (trabajadorSocial) {
      res.locals.trabajadorSocial = {
        nombre: trabajadorSocial.nombre,
        foto_perfil: trabajadorSocial.foto_perfil,
        enLinea: estaEnLinea(trabajadorSocial.ultima_actividad),
      };
    }
  }
  next();
});

// --- Portal de clientes y panel de trabajador social ---

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos, espera unos minutos e inténtalo de nuevo.',
});

function iniciarSesion(req, usuario) {
  // Si ya había una sesión activa de OTRO rol en este mismo navegador (ej.
  // admin en una pestaña, portal en otra), se guarda aparte en vez de
  // perderla -- ver el middleware de restauración más arriba.
  if (req.session.usuario && req.session.usuario.rol !== usuario.rol) {
    req.session.otraSesion = req.session.usuario;
  }
  req.session.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rut: usuario.rut,
    rol: usuario.rol,
    debeCambiarPassword: !!usuario.debe_cambiar_password,
  };
}

// Si la sesion vencio mientras el usuario navegaba (ej. un link en una
// pestana abierta hace rato), requireRole() guarda la URL a la que
// intentaba llegar en session.redirigirDespuesLogin. Al volver a loguearse
// se le devuelve ahi en vez de siempre al dashboard -- salvo que deba
// cambiar la contrasena primero, lo cual tiene prioridad.
function destinoTrasLogin(req, usuario, dashboardPorDefecto) {
  if (usuario.debe_cambiar_password) return '/cambiar-password';
  const destino = req.session.redirigirDespuesLogin;
  delete req.session.redirigirDespuesLogin;
  return destino || dashboardPorDefecto;
}

app.get('/portal/login', (req, res) => {
  if (req.session.usuario && req.session.usuario.rol === 'cliente') {
    return res.redirect('/portal/dashboard');
  }
  res.render('portal/login', { error: null });
});

app.post('/portal/login', loginLimiter, (req, res) => {
  const { rut: rutInput, password } = req.body;
  const usuario = autenticar(rutInput, password);
  if (!usuario || usuario.rol !== 'cliente') {
    return res.status(401).render('portal/login', { error: 'RUT o contraseña incorrectos.' });
  }
  iniciarSesion(req, usuario);
  res.redirect(destinoTrasLogin(req, usuario, '/portal/dashboard'));
});

app.get('/portal/dashboard', requireRole('cliente'), (req, res) => {
  const misCasos = casos.obtenerCasosDeUsuario(req.session.usuario.id).map((caso) => ({
    ...caso,
    icono: iconoParaTipo(caso.tipo_subsidio),
  }));

  const ESTADOS_APROBADOS = ['Aprobado', 'Finalizado'];
  const ESTADOS_RECHAZADOS = ['Rechazado'];

  let documentosPendientes = 0;
  misCasos.forEach((caso) => {
    documentosPendientes += casos.listarSolicitudesDeCaso(caso.id).filter((s) => s.estado === 'pendiente').length;
  });

  const aprobadas = misCasos.filter((c) => ESTADOS_APROBADOS.includes(c.estado_actual)).length;
  const rechazadas = misCasos.filter((c) => ESTADOS_RECHAZADOS.includes(c.estado_actual)).length;
  const enProceso = misCasos.length - aprobadas - rechazadas;

  res.render('portal/dashboard', {
    usuario: req.session.usuario,
    casos: misCasos,
    stats: { total: misCasos.length, documentosPendientes, aprobadas },
    resumen: { enProceso, aprobadas, rechazadas, total: misCasos.length },
    pendientes: casos.obtenerPendientesDeUsuario(req.session.usuario.id),
    fechaHoy: new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  });
});

app.get('/portal/casos/:id', requireRole('cliente'), (req, res) => {
  const caso = casos.obtenerCaso(req.params.id);
  if (!caso || caso.usuario_id !== req.session.usuario.id) {
    return res.status(404).send('<h1>Caso no encontrado</h1>');
  }
  res.render('portal/caso-detalle', {
    usuario: req.session.usuario,
    caso,
    historial: casos.historialHitos(caso.id),
    notas: casos.listarNotas(caso.id, { soloVisibles: true }),
    solicitudes: casos.listarSolicitudesDeCaso(caso.id),
    respuestas: casos.listarRespuestasGenerales(caso.id),
    error: req.query.error || null,
  });
});

app.post('/portal/casos/:id/responder', requireRole('cliente'), async (req, res) => {
  const caso = casos.obtenerCaso(req.params.id);
  if (!caso || caso.usuario_id !== req.session.usuario.id) {
    return res.status(404).send('<h1>Caso no encontrado</h1>');
  }

  const texto = (req.body.texto || '').trim();
  const notaId = req.body.nota_id || null;
  if (texto) {
    casos.crearRespuestaCliente(caso.id, req.session.usuario.id, texto, notaId);
    for (const trabajador of casos.listarTrabajadoresSociales()) {
      await mailer.avisarRespuestaCliente(trabajador.email, caso.cliente_nombre, caso.id);
    }
  }

  res.redirect(`/portal/casos/${caso.id}`);
});

// Subida de documentos: solo permitida contra una solicitud activa creada por
// la trabajadora social (no se puede subir un archivo "libre" sin que se haya
// pedido explícitamente).
app.post('/portal/casos/:casoId/solicitudes/:solicitudId/subir', requireRole('cliente'), (req, res, next) => {
  upload.array('documentos', 10)(req, res, (err) => {
    if (err) {
      return res.redirect(`/portal/casos/${req.params.casoId}?error=${encodeURIComponent(err.message)}`);
    }
    next();
  });
}, async (req, res) => {
  const caso = casos.obtenerCaso(req.params.casoId);
  if (!caso || caso.usuario_id !== req.session.usuario.id) {
    return res.status(404).send('<h1>Caso no encontrado</h1>');
  }
  const solicitud = casos.obtenerSolicitud(req.params.solicitudId);
  if (!solicitud || solicitud.caso_id !== caso.id) {
    return res.status(404).send('<h1>Solicitud no encontrada</h1>');
  }
  if (solicitud.estado === 'completada') {
    return res.redirect(`/portal/casos/${caso.id}`);
  }

  const yaSubidos = casos.contarDocumentosDeSolicitud(solicitud.id);
  const espaciosDisponibles = solicitud.cantidad_requerida - yaSubidos;
  const archivos = req.files || [];

  if (archivos.length === 0) {
    return res.redirect(`/portal/casos/${caso.id}?error=${encodeURIComponent('Selecciona al menos un archivo.')}`);
  }
  if (archivos.length > espaciosDisponibles) {
    return res.redirect(`/portal/casos/${caso.id}?error=${encodeURIComponent(`Solo faltan ${espaciosDisponibles} documento(s) para "${solicitud.tipo_label}".`)}`);
  }

  archivos.forEach((file, index) => {
    casos.crearDocumento({
      casoId: caso.id,
      subidoPor: req.session.usuario.id,
      nombreOriginal: file.originalname,
      nombreArchivo: file.filename,
      tipoMime: file.mimetype,
      tamano: file.size,
      solicitudId: solicitud.id,
      numeroSlot: yaSubidos + index + 1,
    });
  });

  if (yaSubidos + archivos.length >= solicitud.cantidad_requerida) {
    casos.marcarSolicitudCompletada(solicitud.id);
  }

  for (const trabajador of casos.listarTrabajadoresSociales()) {
    await mailer.avisarRespuestaCliente(trabajador.email, caso.cliente_nombre, caso.id);
  }

  res.redirect(`/portal/casos/${caso.id}`);
});

app.get('/portal/documentos/:id/descargar', requireRole('cliente'), (req, res) => {
  const documento = casos.obtenerDocumento(req.params.id);
  if (!documento) return res.status(404).send('<h1>Documento no encontrado</h1>');
  const caso = casos.obtenerCaso(documento.caso_id);
  if (!caso || caso.usuario_id !== req.session.usuario.id) {
    return res.status(404).send('<h1>Documento no encontrado</h1>');
  }
  res.download(rutaArchivo(documento), documento.nombre_original);
});

app.get('/portal/logout', (req, res) => {
  // Si hay otra sesión (de admin) guardada en este mismo navegador, se
  // restaura en vez de destruir toda la sesión y perderla también.
  if (req.session.usuario && req.session.usuario.rol === 'cliente' && req.session.otraSesion) {
    req.session.usuario = req.session.otraSesion;
    delete req.session.otraSesion;
    return res.redirect('/portal/login');
  }
  req.session.destroy(() => res.redirect('/portal/login'));
});

app.get('/admin/login', (req, res) => {
  if (req.session.usuario && req.session.usuario.rol === 'trabajador_social') {
    return res.redirect('/admin/dashboard');
  }
  res.render('admin/login', { error: null });
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { rut: rutInput, password } = req.body;
  const usuario = autenticar(rutInput, password);
  if (!usuario || usuario.rol !== 'trabajador_social') {
    return res.status(401).render('admin/login', { error: 'RUT o contraseña incorrectos.' });
  }
  iniciarSesion(req, usuario);
  res.redirect(destinoTrasLogin(req, usuario, '/admin/dashboard'));
});

app.get('/admin/dashboard', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/dashboard', { usuario: req.session.usuario, casos: casos.listarCasosConCliente() });
});

app.get('/admin/clientes/nuevo', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/clientes-nuevo', { usuario: req.session.usuario, error: null });
});

app.post('/admin/clientes/nuevo', requireRole('trabajador_social'), async (req, res) => {
  const { rut: rutInput, nombre, email, telefono } = req.body;

  if (!rut.esValido(rutInput)) {
    return res.status(400).render('admin/clientes-nuevo', { usuario: req.session.usuario, error: 'El RUT ingresado no es válido.' });
  }

  const passwordTemporal = generarPasswordTemporal();
  let usuarioId;
  try {
    usuarioId = crearUsuario({ rut: rutInput, password: passwordTemporal, nombre, email, telefono, rol: 'cliente' });
  } catch (err) {
    return res.status(400).render('admin/clientes-nuevo', { usuario: req.session.usuario, error: 'No se pudo crear el cliente (¿el RUT ya existe?).' });
  }

  const enviado = await mailer.bienvenidaCliente(email, nombre, rut.normalizar(rutInput), passwordTemporal);
  if (!enviado) {
    console.log(`[aviso] No se pudo enviar el correo de bienvenida. Contraseña temporal para ${rut.normalizar(rutInput)}: ${passwordTemporal}`);
  }

  res.render('admin/clientes-creado', {
    usuario: req.session.usuario,
    nombre,
    rut: rut.normalizar(rutInput),
    passwordTemporal,
    correoEnviado: enviado,
    usuarioId,
  });
});

app.get('/admin/clientes', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/clientes', { usuario: req.session.usuario, clientes: casos.listarClientesConCasos() });
});

app.get('/admin/clientes/:id/editar', requireRole('trabajador_social'), (req, res) => {
  const cliente = casos.obtenerCliente(req.params.id);
  if (!cliente) return res.status(404).send('<h1>Cliente no encontrado</h1>');
  res.render('admin/clientes-editar', { usuario: req.session.usuario, cliente, error: null, passwordTemporal: null });
});

app.post('/admin/clientes/:id/editar', requireRole('trabajador_social'), (req, res) => {
  const cliente = casos.obtenerCliente(req.params.id);
  if (!cliente) return res.status(404).send('<h1>Cliente no encontrado</h1>');
  const { nombre, email, telefono, rut: rutInput } = req.body;
  if (!nombre || !email || !rutInput) {
    return res.status(400).render('admin/clientes-editar', { usuario: req.session.usuario, cliente, error: 'Nombre, email y RUT son obligatorios.', passwordTemporal: null });
  }
  if (!rut.esValido(rutInput)) {
    return res.status(400).render('admin/clientes-editar', { usuario: req.session.usuario, cliente, error: 'El RUT ingresado no es válido.', passwordTemporal: null });
  }
  const resultado = casos.actualizarCliente(cliente.id, { nombre, email, telefono, rut: rut.normalizar(rutInput) });
  if (!resultado.ok) {
    return res.status(400).render('admin/clientes-editar', { usuario: req.session.usuario, cliente, error: resultado.error, passwordTemporal: null });
  }
  res.redirect('/admin/clientes');
});

app.post('/admin/clientes/:id/resetear-password', requireRole('trabajador_social'), (req, res) => {
  const cliente = casos.obtenerCliente(req.params.id);
  if (!cliente) return res.status(404).send('<h1>Cliente no encontrado</h1>');
  const passwordTemporal = resetearPassword(cliente.id);
  res.render('admin/clientes-editar', { usuario: req.session.usuario, cliente, error: null, passwordTemporal });
});

app.post('/admin/clientes/:id/eliminar', requireRole('trabajador_social'), (req, res) => {
  const cliente = casos.obtenerCliente(req.params.id);
  if (!cliente) return res.status(404).send('<h1>Cliente no encontrado</h1>');
  const eliminado = casos.eliminarCliente(cliente.id);
  if (!eliminado) {
    return res.status(400).render('admin/clientes-editar', {
      usuario: req.session.usuario,
      cliente,
      error: 'No se puede eliminar: este cliente ya tiene casos asociados.',
      passwordTemporal: null,
      bloqueadoPorCasos: true,
    });
  }
  res.redirect('/admin/clientes');
});

// Borrado en cascada: elimina al cliente junto con todos sus casos,
// historial, notas y documentos. Irreversible -- se usa cuando el
// borrado normal queda bloqueado por tener casos asociados y, aun así,
// se confirma explícitamente que se quiere perder ese historial.
app.post('/admin/clientes/:id/eliminar-forzado', requireRole('trabajador_social'), (req, res) => {
  const cliente = casos.obtenerCliente(req.params.id);
  if (!cliente) return res.status(404).send('<h1>Cliente no encontrado</h1>');
  casos.eliminarClienteForzado(cliente.id);
  res.redirect('/admin/clientes');
});

app.get('/admin/casos/nuevo', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/casos-nuevo', {
    usuario: req.session.usuario,
    clientes: casos.listarClientes(),
    tipos: TIPOS_SUBSIDIO,
    usuarioIdPreseleccionado: req.query.usuario_id || null,
    error: null,
  });
});

app.post('/admin/casos/nuevo', requireRole('trabajador_social'), (req, res) => {
  const { usuario_id, tipo_subsidio } = req.body;
  if (!usuario_id || !tipo_subsidio) {
    return res.status(400).render('admin/casos-nuevo', {
      usuario: req.session.usuario,
      clientes: casos.listarClientes(),
      tipos: TIPOS_SUBSIDIO,
      usuarioIdPreseleccionado: null,
      error: 'Selecciona un cliente y un tipo de gestión.',
    });
  }
  const casoId = casos.crearCaso({ usuarioId: usuario_id, tipoSubsidio: tipo_subsidio, creadoPor: req.session.usuario.id });
  res.redirect(`/admin/casos/${casoId}`);
});

app.get('/admin/casos/:id', requireRole('trabajador_social'), (req, res) => {
  const caso = casos.obtenerCaso(req.params.id);
  if (!caso) return res.status(404).send('<h1>Caso no encontrado</h1>');
  casos.marcarRespuestasComoVistas(caso.id);
  res.render('admin/caso-detalle', {
    usuario: req.session.usuario,
    caso,
    clienteEnLinea: estaEnLinea(caso.cliente_ultima_actividad),
    hitos: HITOS,
    tiposDocumento: TIPOS_DOCUMENTO,
    historial: casos.historialHitos(caso.id),
    notas: casos.listarNotas(caso.id),
    solicitudes: casos.listarSolicitudesDeCaso(caso.id),
    respuestas: casos.listarRespuestasGenerales(caso.id),
  });
});

app.post('/admin/casos/:id/hito', requireRole('trabajador_social'), async (req, res) => {
  const caso = casos.obtenerCaso(req.params.id);
  if (!caso) return res.status(404).send('<h1>Caso no encontrado</h1>');
  casos.actualizarHito(caso.id, req.body.hito, req.session.usuario.id);
  await mailer.avisarActualizacionCaso(caso.cliente_email, caso.cliente_nombre);
  res.redirect(`/admin/casos/${caso.id}`);
});

app.post('/admin/casos/:casoId/hitos/:hitoId/eliminar', requireRole('trabajador_social'), (req, res) => {
  const caso = casos.obtenerCaso(req.params.casoId);
  if (!caso) return res.status(404).send('<h1>Caso no encontrado</h1>');
  casos.eliminarHito(req.params.hitoId, caso.id);
  res.redirect(`/admin/casos/${caso.id}`);
});

app.post('/admin/casos/:id/nota', requireRole('trabajador_social'), async (req, res) => {
  const caso = casos.obtenerCaso(req.params.id);
  if (!caso) return res.status(404).send('<h1>Caso no encontrado</h1>');

  const visibleParaCliente = req.body.visible_para_cliente === 'on';
  const requiereRespuesta = req.body.requiere_respuesta === 'on';
  const texto = (req.body.texto || '').trim();
  const tiposSeleccionados = [].concat(req.body.tipo_documento || []).filter(Boolean);

  if (!texto && tiposSeleccionados.length === 0) {
    return res.redirect(`/admin/casos/${caso.id}`);
  }

  let notaId = null;
  if (texto) {
    notaId = casos.crearNota(caso.id, req.session.usuario.id, texto, visibleParaCliente, {
      requiereRespuesta,
      tieneSolicitudDocumento: tiposSeleccionados.length > 0,
    });
  }

  tiposSeleccionados.forEach((tipoId) => {
    const tipo = obtenerTipoDocumento(tipoId);
    if (!tipo) return;
    const detalleOtro = (req.body.tipo_otro_detalle || '').trim();
    const tipoFinal = tipoId === 'otro' && detalleOtro ? { ...tipo, label: detalleOtro } : tipo;
    casos.crearSolicitudDocumento({ casoId: caso.id, notaId, tipoDocumento: tipoFinal });
  });

  if ((texto && visibleParaCliente) || tiposSeleccionados.length > 0) {
    await mailer.avisarActualizacionCaso(caso.cliente_email, caso.cliente_nombre);
  }

  res.redirect(`/admin/casos/${caso.id}`);
});

app.post('/admin/casos/:casoId/solicitudes/:solicitudId/eliminar', requireRole('trabajador_social'), (req, res) => {
  const caso = casos.obtenerCaso(req.params.casoId);
  if (!caso) return res.status(404).send('<h1>Caso no encontrado</h1>');
  const solicitud = casos.obtenerSolicitud(req.params.solicitudId);
  if (solicitud && solicitud.caso_id === caso.id && casos.contarDocumentosDeSolicitud(solicitud.id) === 0) {
    casos.eliminarSolicitud(solicitud.id);
  }
  res.redirect(`/admin/casos/${caso.id}`);
});

app.get('/admin/documentos/:id/descargar', requireRole('trabajador_social'), (req, res) => {
  const documento = casos.obtenerDocumento(req.params.id);
  if (!documento) return res.status(404).send('<h1>Documento no encontrado</h1>');
  res.download(rutaArchivo(documento), documento.nombre_original);
});

app.post('/admin/documentos/:id/revision', requireRole('trabajador_social'), (req, res) => {
  const documento = casos.obtenerDocumento(req.params.id);
  if (!documento) return res.status(404).send('<h1>Documento no encontrado</h1>');
  const estado = req.body.estado === 'aprobado' ? 'aprobado' : 'rechazado';
  casos.actualizarEstadoDocumento(documento.id, estado);
  res.redirect(`/admin/casos/${documento.caso_id}`);
});

app.get('/admin/perfil', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/perfil', { usuario: req.session.usuario, cuenta: obtenerUsuarioPorId(req.session.usuario.id), error: null });
});

app.post('/admin/perfil/foto', requireRole('trabajador_social'), (req, res, next) => {
  uploadFotoPerfil.single('foto')(req, res, (err) => {
    if (err) {
      return res.status(400).render('admin/perfil', { usuario: req.session.usuario, cuenta: obtenerUsuarioPorId(req.session.usuario.id), error: err.message });
    }
    next();
  });
}, (req, res) => {
  if (!req.file) {
    return res.status(400).render('admin/perfil', { usuario: req.session.usuario, cuenta: obtenerUsuarioPorId(req.session.usuario.id), error: 'Selecciona una imagen.' });
  }
  actualizarFotoPerfil(req.session.usuario.id, req.file.filename);
  res.redirect('/admin/perfil');
});

app.get('/admin/logout', (req, res) => {
  // Si hay otra sesión (de un cliente) guardada en este mismo navegador, se
  // restaura en vez de destruir toda la sesión y perderla también.
  if (req.session.usuario && req.session.usuario.rol === 'trabajador_social' && req.session.otraSesion) {
    req.session.usuario = req.session.otraSesion;
    delete req.session.otraSesion;
    return res.redirect('/admin/login');
  }
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Cambio de contraseña obligatorio en el primer ingreso (cuentas con contraseña temporal)
app.get('/cambiar-password', (req, res) => {
  if (!req.session.usuario) return res.redirect('/');
  res.render('cambiar-password', { usuario: req.session.usuario, error: null });
});

app.post('/cambiar-password', (req, res) => {
  if (!req.session.usuario) return res.redirect('/');
  // El modal de cambio voluntario de contraseña (ej. desde la tarjeta de
  // cuenta del cliente) envía JSON vía fetch, para no sacar al usuario de
  // su panel; el formulario de cambio obligatorio del primer ingreso sigue
  // siendo un POST normal que renderiza la página completa.
  const esAjax = req.is('application/json');
  const { password, confirmar } = req.body;

  const responderError = (mensaje) => {
    if (esAjax) return res.status(400).json({ ok: false, error: mensaje });
    return res.status(400).render('cambiar-password', { usuario: req.session.usuario, error: mensaje });
  };

  if (!password || password.length < 8) {
    return responderError('La contraseña debe tener al menos 8 caracteres.');
  }
  if (password !== confirmar) {
    return responderError('Las contraseñas no coinciden.');
  }
  cambiarPassword(req.session.usuario.id, password);
  req.session.usuario.debeCambiarPassword = false;
  if (esAjax) return res.json({ ok: true });
  res.redirect(req.session.usuario.rol === 'trabajador_social' ? '/admin/dashboard' : '/portal/dashboard');
});

// Envío del formulario de contacto por correo (Gmail SMTP)
app.post('/api/contact', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const email = (req.body.email || '').trim();
  const telefono = (req.body.telefono || '').trim();
  const mensaje = (req.body.mensaje || '').trim();

  if (!nombre || !email) {
    return res.status(400).json({ ok: false, error: 'Nombre y email son obligatorios.' });
  }

  if (!mailer.mailer) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD no configurados; no se puede enviar el correo.');
    return res.status(500).json({ ok: false, error: 'Envío de correo no configurado.' });
  }

  const enviado = await mailer.enviar({
    to: 'contacto@tuasesorsocial.cl',
    replyTo: email,
    subject: `Nueva consulta web de ${nombre}`,
    text: `Nombre: ${nombre}\nEmail: ${email}\nTeléfono: ${telefono || 'No indicado'}\n\nMensaje:\n${mensaje || 'Sin mensaje adicional.'}`,
  });

  if (!enviado) {
    return res.status(500).json({ ok: false, error: 'No se pudo enviar el correo.' });
  }
  res.json({ ok: true });
});

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '30d' // Cache de 30 días para assets (imágenes, favicon)
}));

// Fotos de perfil: se sirven públicamente (no son datos sensibles), pero
// viven en el volumen persistente de /data para no perderse en un redeploy.
app.use('/avatars', express.static(PERFILES_DIR, { maxAge: '7d' }));

// Rutas SEO-friendly
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/subsidio-electrico/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'subsidio-electrico.html'));
});

app.get('/mediacion-familiar/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'mediacion-familiar.html'));
});

app.get('/subsidio-de-arriendo/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'subsidio-de-arriendo.html'));
});

app.get('/orientacion-socio-juridica/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'orientacion-socio-juridica.html'));
});

app.get('/informes-sociales/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'informes-sociales.html'));
});

app.get('/jornadas-autocuidado/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jornadas-autocuidado.html'));
});

app.get('/credencial-discapacidad/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'credencial-discapacidad.html'));
});

app.get('/registro-social-de-hogares/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'registro-social-de-hogares.html'));
});

app.get('/subsidios-minvu/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'subsidios-minvu.html'));
});

app.get('/que-necesito/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'que-necesito.html'));
});

app.get('/jornada-beneficios-corporativos/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'jornada-beneficios-corporativos.html'));
});

app.get('/convivencia-escolar/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'convivencia-escolar.html'));
});

app.get('/beneficios-adulto-mayor/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'beneficios-adulto-mayor.html'));
});

app.get('/gestion-de-subsidios-estatales/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'gestion-de-subsidios-estatales.html'));
});

// Sitemap y robots
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'robots.txt'));
});

// Redirecciones sin trailing slash (mantener compatibilidad)
app.get('/subsidio-electrico', (req, res) => res.redirect(301, '/subsidio-electrico/'));
app.get('/mediacion-familiar', (req, res) => res.redirect(301, '/mediacion-familiar/'));
app.get('/subsidio-de-arriendo', (req, res) => res.redirect(301, '/subsidio-de-arriendo/'));
app.get('/orientacion-socio-juridica', (req, res) => res.redirect(301, '/orientacion-socio-juridica/'));
app.get('/informes-sociales', (req, res) => res.redirect(301, '/informes-sociales/'));
app.get('/jornadas-autocuidado', (req, res) => res.redirect(301, '/jornadas-autocuidado/'));
app.get('/credencial-discapacidad', (req, res) => res.redirect(301, '/credencial-discapacidad/'));
app.get('/registro-social-de-hogares', (req, res) => res.redirect(301, '/registro-social-de-hogares/'));
app.get('/subsidios-minvu', (req, res) => res.redirect(301, '/subsidios-minvu/'));
app.get('/que-necesito', (req, res) => res.redirect(301, '/que-necesito/'));
app.get('/jornada-beneficios-corporativos', (req, res) => res.redirect(301, '/jornada-beneficios-corporativos/'));
app.get('/convivencia-escolar', (req, res) => res.redirect(301, '/convivencia-escolar/'));
app.get('/beneficios-adulto-mayor', (req, res) => res.redirect(301, '/beneficios-adulto-mayor/'));
app.get('/gestion-de-subsidios-estatales', (req, res) => res.redirect(301, '/gestion-de-subsidios-estatales/'));

// 404 handler
app.use((req, res) => {
  res.status(404).send('<h1>404 - Página no encontrada</h1><p>La página que buscas no existe. <a href="/">Volver al inicio</a></p>');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Listo para deployment en Hetzner`);
});
