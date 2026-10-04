// Icono representativo por tipo de gestión, consistente con los íconos
// usados en las tarjetas de servicio del sitio (views/index.html).
const ICONOS_POR_TIPO = {
  'Gestión de Subsidios Estatales': '📑',
  'Subsidio Eléctrico': '💡',
  'Subsidio de Arriendo': '🏠',
  'Registro Social de Hogares': '🗂️',
  'Subsidios MINVU': '🏗️',
  'Credencial de Discapacidad': '🪪',
  'Beneficios Adulto Mayor': '👴',
  'Informes Sociales': '📋',
  'Mediación Familiar': '👨‍👩‍👧',
  'Orientación Socio-Jurídica': '⚖️',
  'Jornadas de Autocuidado': '💚',
  'Jornada de Beneficios Corporativos': '🏢',
  'Convivencia Escolar': '🏫',
};

function iconoParaTipo(tipo) {
  return ICONOS_POR_TIPO[tipo] || '📁';
}

module.exports = { iconoParaTipo };
