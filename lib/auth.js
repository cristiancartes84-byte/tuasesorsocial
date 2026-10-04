const bcrypt = require('bcryptjs');
const db = require('./db');
const rut = require('./rut');

function crearUsuario({ rut: rutInput, password, nombre, email, rol }) {
  if (!rut.esValido(rutInput)) {
    throw new Error('RUT inválido');
  }
  if (!['cliente', 'trabajador_social'].includes(rol)) {
    throw new Error('Rol inválido');
  }
  const rutNormalizado = rut.normalizar(rutInput);
  const passwordHash = bcrypt.hashSync(password, 10);

  const stmt = db.prepare(`
    INSERT INTO usuarios (rut, password_hash, nombre, email, rol)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(rutNormalizado, passwordHash, nombre, email, rol);
  return info.lastInsertRowid;
}

function autenticar(rutInput, password) {
  const rutNormalizado = rut.normalizar(rutInput);
  const usuario = db.prepare('SELECT * FROM usuarios WHERE rut = ?').get(rutNormalizado);
  if (!usuario) return null;
  if (!bcrypt.compareSync(password, usuario.password_hash)) return null;
  return usuario;
}

function requireRole(rol) {
  return (req, res, next) => {
    if (!req.session || !req.session.usuario || req.session.usuario.rol !== rol) {
      const loginPath = rol === 'trabajador_social' ? '/admin/login' : '/portal/login';
      return res.redirect(loginPath);
    }
    if (req.session.usuario.debeCambiarPassword && req.path !== '/cambiar-password') {
      return res.redirect('/cambiar-password');
    }
    next();
  };
}

function generarPasswordTemporal() {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let clave = '';
  for (let i = 0; i < 10; i++) {
    clave += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return clave;
}

function cambiarPassword(usuarioId, nuevaPassword) {
  const passwordHash = bcrypt.hashSync(nuevaPassword, 10);
  db.prepare(`UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 0 WHERE id = ?`).run(passwordHash, usuarioId);
}

// Usado por la trabajadora social para resetear la contraseña de un cliente
// (ej. si la olvidó). Genera una nueva temporal y obliga a cambiarla de
// nuevo en el próximo ingreso.
function resetearPassword(usuarioId) {
  const passwordTemporal = generarPasswordTemporal();
  const passwordHash = bcrypt.hashSync(passwordTemporal, 10);
  db.prepare(`UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`).run(passwordHash, usuarioId);
  return passwordTemporal;
}

function obtenerUsuarioPorId(usuarioId) {
  return db.prepare(`SELECT id, rut, nombre, email, rol, foto_perfil FROM usuarios WHERE id = ?`).get(usuarioId);
}

function actualizarFotoPerfil(usuarioId, nombreArchivo) {
  db.prepare(`UPDATE usuarios SET foto_perfil = ? WHERE id = ?`).run(nombreArchivo, usuarioId);
}

// Se considera "en línea" si tuvo actividad (carga de página o heartbeat)
// en los últimos 90s: cubre holgadamente el intervalo de 30s del heartbeat
// del cliente, sin marcar a alguien como desconectado apenas deja de navegar.
const UMBRAL_EN_LINEA_MS = 90 * 1000;

function registrarActividad(usuarioId) {
  db.prepare(`UPDATE usuarios SET ultima_actividad = datetime('now') WHERE id = ?`).run(usuarioId);
}

function estaEnLinea(ultimaActividad) {
  if (!ultimaActividad) return false;
  const fecha = new Date(ultimaActividad.replace(' ', 'T') + 'Z');
  return Date.now() - fecha.getTime() < UMBRAL_EN_LINEA_MS;
}

// Asume una sola cuenta de trabajador_social activa, como en el resto del panel admin.
function obtenerTrabajadorSocial() {
  return db.prepare(`SELECT * FROM usuarios WHERE rol = 'trabajador_social' ORDER BY id ASC LIMIT 1`).get();
}

module.exports = {
  crearUsuario,
  autenticar,
  requireRole,
  generarPasswordTemporal,
  cambiarPassword,
  resetearPassword,
  obtenerUsuarioPorId,
  actualizarFotoPerfil,
  registrarActividad,
  estaEnLinea,
  obtenerTrabajadorSocial,
};
