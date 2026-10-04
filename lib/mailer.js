const nodemailer = require('nodemailer');

// Puerto 465 (SMTP sobre SSL) está bloqueado saliente en el servidor de
// producción (Hetzner); se usa 587 con STARTTLS en su lugar. Se agregan
// timeouts para que una falla de red no deje la petición colgada.
const mailer = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    })
  : null;

const SITE_URL = process.env.SITE_URL || 'https://tuasesorsocial.cl';

async function enviar({ to, subject, text, replyTo }) {
  if (!mailer) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD no configurados; no se puede enviar el correo.');
    return false;
  }
  try {
    await mailer.sendMail({
      from: `"Tu Asesor Social" <${process.env.GMAIL_USER}>`,
      to,
      replyTo,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('Error enviando correo:', err);
    return false;
  }
}

// No se incluye contenido sensible en el correo, solo un aviso con link al portal.
function avisarActualizacionCaso(email, nombreCliente) {
  return enviar({
    to: email,
    subject: 'Tienes una actualización en tu gestión',
    text: `Hola ${nombreCliente},\n\nHay una actualización en el estado de tu gestión con Tu Asesor Social. Ingresa a tu portal para revisarla:\n\n${SITE_URL}/portal/login\n\nSaludos,\nTu Asesor Social`,
  });
}

function bienvenidaCliente(email, nombreCliente, rut, passwordTemporal) {
  return enviar({
    to: email,
    subject: 'Acceso a tu portal de gestión — Tu Asesor Social',
    text: `Hola ${nombreCliente},\n\nYa puedes revisar el estado de tu gestión en nuestro portal de clientes:\n\n${SITE_URL}/portal/login\n\nRUT de usuario: ${rut}\nContraseña temporal: ${passwordTemporal}\n\nPor tu seguridad, te pediremos cambiar esta contraseña la primera vez que ingreses.\n\nSaludos,\nTu Asesor Social`,
  });
}

function avisarRespuestaCliente(emailTrabajadorSocial, nombreCliente, casoId) {
  return enviar({
    to: emailTrabajadorSocial,
    subject: `${nombreCliente} respondió en su gestión`,
    text: `${nombreCliente} agregó una respuesta o documento en su gestión (caso #${casoId}). Revisa el panel para verla:\n\n${SITE_URL}/admin/casos/${casoId}`,
  });
}

module.exports = { mailer, enviar, avisarActualizacionCaso, bienvenidaCliente, avisarRespuestaCliente };
