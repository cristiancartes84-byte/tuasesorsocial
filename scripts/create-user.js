// Crea un usuario (cliente o trabajador_social) desde línea de comandos.
// Uso: node scripts/create-user.js <rut> <password> <nombre> <email> <rol>
// Ejemplo: node scripts/create-user.js 12345678-9 clave123 "Juan Pérez" juan@correo.com cliente

const { crearUsuario } = require('../lib/auth');

const [rut, password, nombre, email, rol] = process.argv.slice(2);

if (!rut || !password || !nombre || !email || !rol) {
  console.error('Uso: node scripts/create-user.js <rut> <password> <nombre> <email> <cliente|trabajador_social>');
  process.exit(1);
}

try {
  const id = crearUsuario({ rut, password, nombre, email, rol });
  console.log(`Usuario creado con id ${id} (rol: ${rol})`);
} catch (err) {
  console.error('Error al crear usuario:', err.message);
  process.exit(1);
}
