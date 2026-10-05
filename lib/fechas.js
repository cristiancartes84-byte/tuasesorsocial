const ZONA = 'America/Santiago';

// Las fechas se guardan en la base en UTC (datetime('now') de SQLite,
// formato "YYYY-MM-DD HH:MM:SS"). Esta funcion las muestra en hora de
// Santiago de Chile, que es la zona de la trabajadora social y sus
// clientes, sin importar en que zona horaria corra el servidor.
function formatearFecha(fechaUTC) {
  if (!fechaUTC) return '';
  const fecha = new Date(fechaUTC.replace(' ', 'T') + 'Z');
  return fecha.toLocaleString('es-CL', {
    timeZone: ZONA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fechaHoyLarga() {
  return new Date().toLocaleDateString('es-CL', {
    timeZone: ZONA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

module.exports = { formatearFecha, fechaHoyLarga, ZONA };
