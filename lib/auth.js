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
    next();
  };
}

module.exports = { crearUsuario, autenticar, requireRole };
