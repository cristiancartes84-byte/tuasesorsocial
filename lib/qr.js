const QRCode = require('qrcode');

const SITE_URL = process.env.SITE_URL || 'https://tuasesorsocial.cl';

let cache = null;

// El QR apunta siempre a la misma URL, así que se genera una sola vez y se
// reutiliza en todas las peticiones (evita recalcularlo en cada carga de
// página del panel).
async function obtenerQrSitio() {
  if (!cache) {
    cache = await QRCode.toDataURL(SITE_URL, {
      width: 220,
      margin: 1,
      color: { dark: '#1e293b', light: '#ffffff' },
    });
  }
  return cache;
}

module.exports = { obtenerQrSitio };
