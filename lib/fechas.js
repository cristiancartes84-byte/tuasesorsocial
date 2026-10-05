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

// Minutos de diferencia entre la hora de pared en Santiago y el instante
// UTC real, para una fecha de referencia dada (maneja horario de verano:
// el offset cambia segun la epoca del año).
function offsetSantiagoMinutos(fechaRef) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const partes = {};
  dtf.formatToParts(fechaRef).forEach((p) => { partes[p.type] = p.value; });
  const comoUTC = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return Math.round((comoUTC - fechaRef.getTime()) / 60000);
}

// Construye el instante UTC (objeto Date) correspondiente a una hora de
// pared en Santiago -- ej. construirFechaSantiago(2026,10,6,9,0) es las
// 9:00 AM de ese dia en Chile, ya convertido a UTC para guardar en la base.
function construirFechaSantiago(anio, mes, dia, hora, minuto) {
  let ms = Date.UTC(anio, mes - 1, dia, hora, minuto, 0);
  for (let i = 0; i < 2; i++) {
    const offsetMin = offsetSantiagoMinutos(new Date(ms));
    const nuevo = Date.UTC(anio, mes - 1, dia, hora, minuto, 0) - offsetMin * 60000;
    if (nuevo === ms) break;
    ms = nuevo;
  }
  return new Date(ms);
}

// Componentes {anio, mes, dia} de "hoy" en Santiago, y el numero de dia de
// la semana (0=domingo ... 6=sabado) correspondiente.
function hoyEnSantiago() {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const partes = {};
  dtf.formatToParts(new Date()).forEach((p) => { partes[p.type] = p.value; });
  const diasCorto = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    anio: +partes.year,
    mes: +partes.month,
    dia: +partes.day,
    diaSemana: diasCorto.indexOf(partes.weekday),
  };
}

// Formatea una fecha UTC a formato "HH:MM" hora de Santiago.
function formatearHora(fechaUTCoDate) {
  const fecha = typeof fechaUTCoDate === 'string' ? new Date(fechaUTCoDate.replace(' ', 'T') + 'Z') : fechaUTCoDate;
  return fecha.toLocaleTimeString('es-CL', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

// Formatea una fecha UTC a "lunes 6 de octubre" hora de Santiago.
function formatearDiaLargo(fechaUTCoDate) {
  const fecha = typeof fechaUTCoDate === 'string' ? new Date(fechaUTCoDate.replace(' ', 'T') + 'Z') : fechaUTCoDate;
  return fecha.toLocaleDateString('es-CL', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long' });
}

// Convierte un objeto Date (instante UTC) al string "YYYY-MM-DD HH:MM:SS"
// que usa SQLite/datetime('now') para guardarlo en la base.
function aSqlite(fecha) {
  return fecha.toISOString().slice(0, 19).replace('T', ' ');
}

module.exports = {
  ZONA,
  formatearFecha,
  fechaHoyLarga,
  construirFechaSantiago,
  hoyEnSantiago,
  formatearHora,
  formatearDiaLargo,
  aSqlite,
};
