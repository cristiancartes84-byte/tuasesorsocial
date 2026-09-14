require('dotenv').config();

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { autenticar, requireRole, generarPasswordTemporal, cambiarPassword, crearUsuario } = require('./lib/auth');
const rut = require('./lib/rut');
const casos = require('./lib/casos');
const { HITOS, TIPOS_SUBSIDIO } = require('./lib/hitos');
const { TIPOS_DOCUMENTO, obtenerTipoDocumento } = require('./lib/documentos-catalogo');
const mailer = require('./lib/mailer');
const { upload, rutaArchivo } = require('./lib/uploads');

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
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 horas
  },
}));

// --- Portal de clientes y panel de trabajador social ---

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Demasiados intentos, espera unos minutos e inténtalo de nuevo.',
});

function iniciarSesion(req, usuario) {
  req.session.usuario = {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    debeCambiarPassword: !!usuario.debe_cambiar_password,
  };
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
  res.redirect(usuario.debe_cambiar_password ? '/cambiar-password' : '/portal/dashboard');
});

app.get('/portal/dashboard', requireRole('cliente'), (req, res) => {
  const misCasos = casos.obtenerCasosDeUsuario(req.session.usuario.id);
  res.render('portal/dashboard', { usuario: req.session.usuario, casos: misCasos });
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
  res.redirect(usuario.debe_cambiar_password ? '/cambiar-password' : '/admin/dashboard');
});

app.get('/admin/dashboard', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/dashboard', { usuario: req.session.usuario, casos: casos.listarCasosConCliente() });
});

app.get('/admin/clientes/nuevo', requireRole('trabajador_social'), (req, res) => {
  res.render('admin/clientes-nuevo', { usuario: req.session.usuario, error: null });
});

app.post('/admin/clientes/nuevo', requireRole('trabajador_social'), async (req, res) => {
  const { rut: rutInput, nombre, email } = req.body;

  if (!rut.esValido(rutInput)) {
    return res.status(400).render('admin/clientes-nuevo', { usuario: req.session.usuario, error: 'El RUT ingresado no es válido.' });
  }

  const passwordTemporal = generarPasswordTemporal();
  let usuarioId;
  try {
    usuarioId = crearUsuario({ rut: rutInput, password: passwordTemporal, nombre, email, rol: 'cliente' });
  } catch (err) {
    return res.status(400).render('admin/clientes-nuevo', { usuario: req.session.usuario, error: 'No se pudo crear el cliente (¿el RUT ya existe?).' });
  }

  const enviado = await mailer.bienvenidaCliente(email, nombre, rut.normalizar(rutInput), passwordTemporal);
  if (!enviado) {
    console.log(`[aviso] No se pudo enviar el correo de bienvenida. Contraseña temporal para ${rut.normalizar(rutInput)}: ${passwordTemporal}`);
  }

  res.redirect(`/admin/casos/nuevo?usuario_id=${usuarioId}`);
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
  res.render('admin/caso-detalle', {
    usuario: req.session.usuario,
    caso,
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

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Cambio de contraseña obligatorio en el primer ingreso (cuentas con contraseña temporal)
app.get('/cambiar-password', (req, res) => {
  if (!req.session.usuario) return res.redirect('/');
  res.render('cambiar-password', { usuario: req.session.usuario, error: null });
});

app.post('/cambiar-password', (req, res) => {
  if (!req.session.usuario) return res.redirect('/');
  const { password, confirmar } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).render('cambiar-password', { usuario: req.session.usuario, error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (password !== confirmar) {
    return res.status(400).render('cambiar-password', { usuario: req.session.usuario, error: 'Las contraseñas no coinciden.' });
  }
  cambiarPassword(req.session.usuario.id, password);
  req.session.usuario.debeCambiarPassword = false;
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
