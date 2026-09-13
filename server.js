require('dotenv').config();

const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const { autenticar } = require('./lib/auth');

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

app.get('/portal/login', (req, res) => {
  if (req.session.usuario && req.session.usuario.rol === 'cliente') {
    return res.redirect('/portal/dashboard');
  }
  res.render('portal/login', { error: null });
});

app.post('/portal/login', loginLimiter, (req, res) => {
  const { rut, password } = req.body;
  const usuario = autenticar(rut, password);
  if (!usuario || usuario.rol !== 'cliente') {
    return res.status(401).render('portal/login', { error: 'RUT o contraseña incorrectos.' });
  }
  req.session.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
  res.redirect('/portal/dashboard');
});

app.get('/portal/dashboard', (req, res) => {
  if (!req.session.usuario || req.session.usuario.rol !== 'cliente') {
    return res.redirect('/portal/login');
  }
  res.render('portal/dashboard', { usuario: req.session.usuario });
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
  const { rut, password } = req.body;
  const usuario = autenticar(rut, password);
  if (!usuario || usuario.rol !== 'trabajador_social') {
    return res.status(401).render('admin/login', { error: 'RUT o contraseña incorrectos.' });
  }
  req.session.usuario = { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol };
  res.redirect('/admin/dashboard');
});

app.get('/admin/dashboard', (req, res) => {
  if (!req.session.usuario || req.session.usuario.rol !== 'trabajador_social') {
    return res.redirect('/admin/login');
  }
  res.render('admin/dashboard', { usuario: req.session.usuario });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// Envío del formulario de contacto por correo (Gmail SMTP)
const mailer = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  : null;

app.post('/api/contact', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  const email = (req.body.email || '').trim();
  const telefono = (req.body.telefono || '').trim();
  const mensaje = (req.body.mensaje || '').trim();

  if (!nombre || !email) {
    return res.status(400).json({ ok: false, error: 'Nombre y email son obligatorios.' });
  }

  if (!mailer) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD no configurados; no se puede enviar el correo.');
    return res.status(500).json({ ok: false, error: 'Envío de correo no configurado.' });
  }

  try {
    await mailer.sendMail({
      from: `"Tu Asesor Social - Web" <${process.env.GMAIL_USER}>`,
      to: 'contacto@tuasesorsocial.cl',
      replyTo: email,
      subject: `Nueva consulta web de ${nombre}`,
      text: `Nombre: ${nombre}\nEmail: ${email}\nTeléfono: ${telefono || 'No indicado'}\n\nMensaje:\n${mensaje || 'Sin mensaje adicional.'}`,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando correo de contacto:', err);
    res.status(500).json({ ok: false, error: 'No se pudo enviar el correo.' });
  }
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

// 404 handler
app.use((req, res) => {
  res.status(404).send('<h1>404 - Página no encontrada</h1><p>La página que buscas no existe. <a href="/">Volver al inicio</a></p>');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Listo para deployment en Hetzner`);
});
