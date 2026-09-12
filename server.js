const express = require('express');
const path = require('path');
const compression = require('compression');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Seguridad y compresión
app.use(helmet({
  contentSecurityPolicy: false, // Permitir inline scripts para animaciones
}));
app.use(compression());

// Archivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d' // Cache de 1 día para assets
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

// 404 handler
app.use((req, res) => {
  res.status(404).send('<h1>404 - Página no encontrada</h1><p>La página que buscas no existe. <a href="/">Volver al inicio</a></p>');
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Listo para deployment en Hetzner`);
});
