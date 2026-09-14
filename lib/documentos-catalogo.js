// Catálogo de tipos de documento que la trabajadora social puede solicitar
// a un cliente. "cantidad" define cuántos archivos individuales debe subir
// el cliente para completar la solicitud (ej. 3 liquidaciones = 3 archivos).
const TIPOS_DOCUMENTO = [
  { id: 'cedula_identidad', label: 'Cédula de identidad (ambos lados)', cantidad: 1 },
  { id: 'boleta_luz', label: 'Boleta de luz', cantidad: 1 },
  { id: 'liquidaciones_3', label: '3 últimas liquidaciones de sueldo', cantidad: 3 },
  { id: 'certificado_residencia', label: 'Certificado de residencia', cantidad: 1 },
  { id: 'certificado_afc', label: 'Certificado de AFC (Seguro de Cesantía)', cantidad: 1 },
  { id: 'comprobante_domicilio', label: 'Comprobante de domicilio', cantidad: 1 },
  { id: 'certificado_medico', label: 'Certificado médico', cantidad: 1 },
  { id: 'certificado_nacimiento', label: 'Certificado de nacimiento', cantidad: 1 },
  { id: 'otro', label: 'Otro documento', cantidad: 1 },
];

function obtenerTipoDocumento(id) {
  return TIPOS_DOCUMENTO.find((t) => t.id === id) || null;
}

module.exports = { TIPOS_DOCUMENTO, obtenerTipoDocumento };
