const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const db = require('./db');

const INFORMES_DIR = path.join(__dirname, '..', 'data', 'uploads', 'informes');
const TAMANO_MAXIMO = 15 * 1024 * 1024; // 15 MB
const TEXTO_MARCA = 'TU ASESOR SOCIAL';

// Los PDF se procesan en memoria (hay que estampar la marca antes de guardar),
// así que nunca queda en disco la versión sin marca de un borrador.
const subirPdf = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('El informe debe ser un archivo PDF.'));
    }
    cb(null, true);
  },
});

// Estampa el nombre del sitio en diagonal, grande y translúcido, en todas las
// páginas. Respeta páginas rotadas. Devuelve los bytes del nuevo PDF.
async function aplicarMarcaDeAgua(bytes) {
  let pdf;
  try {
    pdf = await PDFDocument.load(bytes);
  } catch (err) {
    if (err && err.name === 'EncryptedPDFError') {
      throw new Error('El PDF está protegido con contraseña. Quítale la protección y vuelve a subirlo.');
    }
    throw new Error('No se pudo leer el PDF. Verifica que el archivo no esté dañado.');
  }
  const fuente = await pdf.embedFont(StandardFonts.HelveticaBold);
  const anchoUnitario = fuente.widthOfTextAtSize(TEXTO_MARCA, 1);

  for (const pagina of pdf.getPages()) {
    const { width: w, height: h } = pagina.getSize();
    const rotacion = pagina.getRotation().angle;
    const visibleW = rotacion % 180 === 0 ? w : h;
    const visibleH = rotacion % 180 === 0 ? h : w;
    const diagonal = Math.sqrt(visibleW * visibleW + visibleH * visibleH);
    const tamano = (diagonal * 0.72) / anchoUnitario;
    const anchoTexto = anchoUnitario * tamano;
    const altoTexto = tamano * 0.7; // altura aproximada de las mayúsculas

    // El texto se ve a 45° respecto de la pantalla; en el espacio de la página
    // eso es 45° + la rotación de la página.
    const angulo = 45 + rotacion;
    const rad = (angulo * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const x = cx - (anchoTexto / 2) * Math.cos(rad) + (altoTexto / 2) * Math.sin(rad);
    const y = cy - (anchoTexto / 2) * Math.sin(rad) - (altoTexto / 2) * Math.cos(rad);

    pagina.drawText(TEXTO_MARCA, {
      x,
      y,
      size: tamano,
      font: fuente,
      color: rgb(0.45, 0.45, 0.5),
      opacity: 0.22,
      rotate: degrees(angulo),
    });
  }
  return Buffer.from(await pdf.save());
}

function guardarArchivo(casoId, bytes) {
  const dir = path.join(INFORMES_DIR, String(casoId));
  fs.mkdirSync(dir, { recursive: true });
  const nombre = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.pdf`;
  fs.writeFileSync(path.join(dir, nombre), bytes);
  return nombre;
}

function rutaInforme(informe) {
  return path.join(INFORMES_DIR, String(informe.caso_id), informe.nombre_archivo);
}

function listarInformesDeCaso(casoId) {
  return db.prepare(`SELECT * FROM informes WHERE caso_id = ? ORDER BY es_oficial DESC, version DESC, id DESC`).all(casoId);
}

function obtenerInforme(id) {
  return db.prepare(`SELECT * FROM informes WHERE id = ?`).get(id);
}

// Último borrador subido (el que el cliente tiene que revisar).
function ultimoBorrador(casoId) {
  return db.prepare(`SELECT * FROM informes WHERE caso_id = ? AND es_oficial = 0 ORDER BY version DESC, id DESC LIMIT 1`).get(casoId);
}

function obtenerOficial(casoId) {
  return db.prepare(`SELECT * FROM informes WHERE caso_id = ? AND es_oficial = 1 ORDER BY id DESC LIMIT 1`).get(casoId);
}

// Sube una nueva versión del borrador. Las versiones anteriores que seguían
// abiertas pasan a "reemplazado". Devuelve el informe creado.
async function subirBorrador({ caso, bytes, nombreOriginal, subidoPor }) {
  if (obtenerOficial(caso.id)) {
    throw new Error('Este caso ya tiene el informe oficial entregado.');
  }
  const conMarca = await aplicarMarcaDeAgua(bytes);
  const nombreArchivo = guardarArchivo(caso.id, conMarca);
  const anterior = ultimoBorrador(caso.id);
  const version = anterior ? anterior.version + 1 : 1;

  const crear = db.transaction(() => {
    db.prepare(`UPDATE informes SET estado = 'reemplazado' WHERE caso_id = ? AND es_oficial = 0 AND estado IN ('borrador', 'cambios_solicitados')`).run(caso.id);
    return db.prepare(`
      INSERT INTO informes (caso_id, tipo_informe, version, es_oficial, estado, nombre_original, nombre_archivo, tamano, subido_por)
      VALUES (?, ?, ?, 0, 'borrador', ?, ?, ?, ?)
    `).run(caso.id, caso.tipo_subsidio, version, nombreOriginal, nombreArchivo, conMarca.length, subidoPor).lastInsertRowid;
  });
  return obtenerInforme(crear());
}

// El oficial firmado se guarda tal cual (no se toca el PDF para no invalidar
// la firma electrónica) y solo se acepta cuando el cliente ya dio su visto bueno.
async function subirOficial({ caso, bytes, nombreOriginal, subidoPor }) {
  const borrador = ultimoBorrador(caso.id);
  if (!borrador || borrador.estado !== 'aprobado') {
    throw new Error('Para subir el informe oficial, el cliente primero debe dar su visto bueno al borrador.');
  }
  if (obtenerOficial(caso.id)) {
    throw new Error('Este caso ya tiene el informe oficial entregado.');
  }
  const nombreArchivo = guardarArchivo(caso.id, bytes);
  const id = db.prepare(`
    INSERT INTO informes (caso_id, tipo_informe, version, es_oficial, estado, nombre_original, nombre_archivo, tamano, subido_por)
    VALUES (?, ?, ?, 1, 'oficial', ?, ?, ?, ?)
  `).run(caso.id, caso.tipo_subsidio, borrador.version, nombreOriginal, nombreArchivo, bytes.length, subidoPor).lastInsertRowid;
  return obtenerInforme(id);
}

// Respuesta del cliente al último borrador: visto bueno (con RUT y clave
// verificados antes de llamar aquí) o solicitud de cambios con comentario.
function responderBorrador({ informe, aprueba, comentario, rutConfirmacion }) {
  db.prepare(`
    UPDATE informes
    SET estado = ?, comentario_cliente = ?, respondido_en = datetime('now'), rut_confirmacion = ?
    WHERE id = ? AND es_oficial = 0 AND estado = 'borrador'
  `).run(aprueba ? 'aprobado' : 'cambios_solicitados', comentario || null, aprueba ? rutConfirmacion : null, informe.id);
}

module.exports = {
  subirPdf,
  aplicarMarcaDeAgua,
  rutaInforme,
  listarInformesDeCaso,
  obtenerInforme,
  ultimoBorrador,
  obtenerOficial,
  subirBorrador,
  subirOficial,
  responderBorrador,
};
