// Catálogo de hitos/etapas para la gestión de subsidios estatales.
// El orden define la secuencia esperada, pero el trabajador social puede
// mover el caso a cualquier hito (por ejemplo, para devolverlo a "Documentación
// pendiente" si falta algo).
const HITOS = [
  'Solicitud recibida',
  'Documentación en revisión',
  'Documentación pendiente por parte del cliente',
  'En tramitación ante el organismo',
  'Resolución en proceso',
  'Aprobado',
  'Rechazado',
  'Finalizado',
];

const TIPOS_SUBSIDIO = [
  'Subsidio Eléctrico',
  'Subsidio de Arriendo',
  'Registro Social de Hogares',
  'Subsidios MINVU',
  'Credencial de Discapacidad',
  'Beneficios Adulto Mayor',
  'Informes Sociales',
  'Mediación Familiar',
  'Orientación Socio-Jurídica',
  'Otro',
];

module.exports = { HITOS, TIPOS_SUBSIDIO };
