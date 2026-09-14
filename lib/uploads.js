const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOADS_DIR = path.join(__dirname, '..', 'data', 'uploads');

const TIPOS_PERMITIDOS = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const extension = TIPOS_PERMITIDOS[file.mimetype] || '';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_PERMITIDOS[file.mimetype]) {
      return cb(new Error('Tipo de archivo no permitido. Solo se aceptan PDF, JPG o PNG.'));
    }
    cb(null, true);
  },
});

function rutaArchivo(documento) {
  return path.join(UPLOADS_DIR, String(documento.caso_id), documento.nombre_archivo);
}

module.exports = { upload, rutaArchivo, TAMANO_MAXIMO };
