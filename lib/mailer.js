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

// Alias ya verificado en la cuenta Gmail autenticada (Configuración →
// Cuentas e importación → "Enviar mensaje como"), usado para que los
// correos a clientes salgan con esta dirección en vez del Gmail interno.
const MAIL_FROM = process.env.MAIL_FROM || 'francis@tuasesorsocial.cl';

// Envoltorio HTML con los colores de marca del sitio (degradado azul→verde),
// para que los correos se vean consistentes con tuasesorsocial.cl. Usa
// estilos en línea porque muchos clientes de correo ignoran <style> externos.
function plantillaHtml(cuerpoHtml) {
  return `
<div style="background:#f4f6fa;padding:32px 16px;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,0.08);">
    <div style="background:linear-gradient(135deg,#2563eb 0%,#059669 100%);padding:28px 32px;text-align:center;">
      <div style="color:#ffffff;font-size:20px;font-weight:700;">Tu Asesor Social</div>
      <div style="color:rgba(255,255,255,0.85);font-size:13px;margin-top:4px;">Asesoría social profesional en Chile</div>
    </div>
    <div style="padding:32px;color:#1f2937;font-size:15px;line-height:1.6;">
      ${cuerpoHtml}
    </div>
    <div style="padding:20px 32px;background:#f8fafc;text-align:center;color:#94a3b8;font-size:12px;line-height:1.5;">
      Francis Carter Sanhueza · Trabajadora Social<br>
      Este correo fue enviado automáticamente desde el portal de tuasesorsocial.cl
    </div>
  </div>
</div>`;
}

function botonHtml(texto, url) {
  return `<div style="text-align:center;margin:24px 0;">
    <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#2563eb 0%,#059669 100%);color:#ffffff;text-decoration:none;padding:13px 30px;border-radius:50px;font-weight:600;font-size:15px;">${texto}</a>
  </div>`;
}

function credencialesHtml(rut, passwordTemporal) {
  return `<div style="background:#f8fafc;border-radius:12px;padding:18px 22px;margin:20px 0;">
    <p style="margin:0 0 4px;font-size:12px;color:#64748b;">RUT de usuario</p>
    <p style="margin:0 0 14px;font-size:17px;font-weight:700;font-family:monospace;color:#1f2937;">${rut}</p>
    <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Contraseña temporal</p>
    <p style="margin:0;font-size:17px;font-weight:700;font-family:monospace;color:#1f2937;">${passwordTemporal}</p>
  </div>`;
}

async function enviar({ to, subject, text, html, replyTo }) {
  if (!mailer) {
    console.error('GMAIL_USER / GMAIL_APP_PASSWORD no configurados; no se puede enviar el correo.');
    return false;
  }
  try {
    await mailer.sendMail({
      from: `"Tu Asesor Social" <${MAIL_FROM}>`,
      to,
      replyTo,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error('Error enviando correo:', err);
    return false;
  }
}

// No se incluye contenido sensible en el correo, solo un aviso con link al portal.
function avisarActualizacionCaso(email, nombreCliente) {
  const loginUrl = `${SITE_URL}/portal/login`;
  return enviar({
    to: email,
    subject: 'Tienes una actualización en tu gestión',
    text: `Hola ${nombreCliente},\n\nHay una actualización en el estado de tu gestión con Tu Asesor Social. Ingresa a tu portal para revisarla:\n\n${loginUrl}\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${nombreCliente}</strong>,</p>
      <p style="margin:0 0 8px;">Hay una actualización en el estado de tu gestión. Ingresa a tu portal para revisarla.</p>
      ${botonHtml('Ver mi gestión', loginUrl)}
    `),
  });
}

function bienvenidaCliente(email, nombreCliente, rut, passwordTemporal) {
  const loginUrl = `${SITE_URL}/portal/login`;
  return enviar({
    to: email,
    subject: 'Acceso a tu portal de gestión — Tu Asesor Social',
    text: `Hola ${nombreCliente},\n\nYa puedes revisar el estado de tu gestión en nuestro portal de clientes:\n\n${loginUrl}\n\nRUT de usuario: ${rut}\nContraseña temporal: ${passwordTemporal}\n\nPor tu seguridad, te pediremos cambiar esta contraseña la primera vez que ingreses.\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${nombreCliente}</strong>,</p>
      <p style="margin:0 0 8px;">Ya puedes revisar el estado de tu gestión en nuestro portal de clientes.</p>
      ${credencialesHtml(rut, passwordTemporal)}
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Por tu seguridad, te pediremos cambiar esta contraseña la primera vez que ingreses.</p>
      ${botonHtml('Ingresar al portal', loginUrl)}
    `),
  });
}

function avisarRespuestaCliente(emailTrabajadorSocial, nombreCliente, casoId) {
  const casoUrl = `${SITE_URL}/admin/casos/${casoId}`;
  return enviar({
    to: emailTrabajadorSocial,
    subject: `${nombreCliente} respondió en su gestión`,
    text: `${nombreCliente} agregó una respuesta o documento en su gestión (caso #${casoId}). Revisa el panel para verla:\n\n${casoUrl}`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;"><strong>${nombreCliente}</strong> agregó una respuesta o documento en su gestión.</p>
      ${botonHtml('Ver caso en el panel', casoUrl)}
    `),
  });
}

module.exports = { mailer, enviar, avisarActualizacionCaso, bienvenidaCliente, avisarRespuestaCliente };
