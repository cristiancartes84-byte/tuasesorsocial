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
    const dir = path.join(UPLOADS_DIR, String(req.params.casoId));
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

// Fotos de perfil: se sirven directamente como archivos estáticos públicos
// (no son datos sensibles como los documentos de un caso), pero viven en el
// volumen persistente para no perderse en cada redeploy.
const PERFILES_DIR = path.join(UPLOADS_DIR, 'perfiles');

const TIPOS_IMAGEN_PERMITIDOS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const storagePerfil = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(PERFILES_DIR, { recursive: true });
    cb(null, PERFILES_DIR);
  },
  filename: (req, file, cb) => {
    const extension = TIPOS_IMAGEN_PERMITIDOS[file.mimetype] || '';
    cb(null, `${req.session.usuario.id}-${Date.now()}${extension}`);
  },
});

const uploadFotoPerfil = multer({
  storage: storagePerfil,
  limits: { fileSize: 3 * 1024 * 1024 }, // 3 MB
  fileFilter: (req, file, cb) => {
    if (!TIPOS_IMAGEN_PERMITIDOS[file.mimetype]) {
      return cb(new Error('Tipo de imagen no permitido. Solo se aceptan JPG, PNG o WEBP.'));
    }
    cb(null, true);
  },
});

module.exports = { upload, rutaArchivo, TAMANO_MAXIMO, uploadFotoPerfil, PERFILES_DIR };
