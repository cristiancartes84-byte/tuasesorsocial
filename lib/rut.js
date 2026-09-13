// Utilidades para validar y normalizar RUT chileno.

function limpiar(rut) {
  return String(rut || '').replace(/[.\s]/g, '').toUpperCase();
}

// Normaliza a formato "12345678-9" (sin puntos, con guión, DV en mayúscula).
function normalizar(rut) {
  const limpio = limpiar(rut).replace('-', '');
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1);
  const dv = limpio.slice(-1);
  return `${cuerpo}-${dv}`;
}

function calcularDV(cuerpo) {
  let suma = 0;
  let multiplo = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += parseInt(cuerpo[i], 10) * multiplo;
    multiplo = multiplo === 7 ? 2 : multiplo + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

function esValido(rut) {
  const normalizado = normalizar(rut);
  const [cuerpo, dv] = normalizado.split('-');
  if (!cuerpo || !dv) return false;
  if (!/^\d{7,8}$/.test(cuerpo)) return false;
  return calcularDV(cuerpo) === dv;
}

module.exports = { normalizar, esValido, limpiar };
