const nodemailer = require('nodemailer');

// Puerto 465 (SMTP sobre SSL) está bloqueado saliente en el servidor de
// producción (Hetzner); se usa 587 con STARTTLS en su lugar. Se agregan
// timeouts para que una falla de red no deje la petición colgada.
const opcionesComunes = {
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
};

// Principal: SMTP propio del dominio (casilla en BanaHosting). Sus correos
// salen firmados (SPF/DKIM) por el propio dominio, sin la advertencia de
// "no se puede comprobar el remitente". Se activa con SMTP_HOST, SMTP_USER y
// SMTP_PASSWORD (SMTP_PORT opcional: 587 STARTTLS por defecto, 465 = SSL).
const smtpPropio = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      ...opcionesComunes,
    })
  : null;

// Respaldo: Gmail por 587 con STARTTLS.
const smtpGmail = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
      ...opcionesComunes,
    })
  : null;

const mailer = smtpPropio || smtpGmail;

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

// Motivo (legible) del último envío fallido, para mostrarlo en el panel y no
// tener que ir a los logs del servidor para saber qué pasó.
let ultimoFallo = null;

function describirFallo(err) {
  const codigo = err && err.code;
  const respuesta = (err && err.response) || '';
  if (codigo === 'EAUTH' || /535|Username and Password not accepted|Application-specific password/i.test(respuesta)) {
    return 'Usuario o contraseña rechazados: pueden haber cambiado o estar mal copiados.';
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'EDNS', 'ENOTFOUND'].includes(codigo)) {
    return 'El servidor no pudo conectarse al servidor de correo (puerto 587 bloqueado o sin salida a internet).';
  }
  if (codigo === 'EENVELOPE') return 'La dirección de correo del destinatario no es válida.';
  return `Error de envío${codigo ? ` (${codigo})` : ''}: ${(err && err.message) || 'desconocido'}`;
}

function motivoUltimoFallo() {
  return ultimoFallo;
}

// `interno`: avisos para la trabajadora social. Se envían primero por la propia
// cuenta Gmail del sistema y con esa misma cuenta como remitente: un correo
// que dice venir de francis@tuasesorsocial.cl y llega a esa misma casilla (o a
// su Gmail, que la usa como alias) suele ser descartado como suplantación.
async function enviar({ to, subject, text, html, replyTo, interno = false }) {
  if (!mailer) {
    console.error('Variables de correo no configuradas; no se puede enviar el correo.');
    ultimoFallo = 'Faltan las variables de correo en Coolify (SMTP_HOST/SMTP_USER/SMTP_PASSWORD o GMAIL_USER/GMAIL_APP_PASSWORD).';
    return false;
  }
  const mensaje = {
    from: `"Tu Asesor Social" <${MAIL_FROM}>`,
    to,
    replyTo,
    subject,
    text,
    html,
  };
  const mensajeInterno = { ...mensaje, from: `"Portal Tu Asesor Social" <${process.env.GMAIL_USER}>`, replyTo: undefined };
  const propio = smtpPropio && { nombre: 'SMTP del dominio', transporte: smtpPropio, mensaje };
  const gmail = smtpGmail && { nombre: 'Gmail', transporte: smtpGmail, mensaje: interno ? mensajeInterno : mensaje };
  const intentos = (interno ? [gmail, propio] : [propio, gmail]).filter(Boolean);
  for (const { nombre, transporte, mensaje: msg } of intentos) {
    try {
      await transporte.sendMail(msg);
      console.log(`Correo enviado a ${to} (${nombre}): ${subject}`);
      ultimoFallo = null;
      return true;
    } catch (err) {
      console.error(`Error enviando correo (${nombre}):`, err);
      ultimoFallo = `${nombre}: ${describirFallo(err)}`;
    }
  }
  return false;
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
    interno: true,
    to: emailTrabajadorSocial,
    subject: `${nombreCliente} respondió en su gestión`,
    text: `${nombreCliente} agregó una respuesta o documento en su gestión (caso #${casoId}). Revisa el panel para verla:\n\n${casoUrl}`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;"><strong>${nombreCliente}</strong> agregó una respuesta o documento en su gestión.</p>
      ${botonHtml('Ver caso en el panel', casoUrl)}
    `),
  });
}

function avisarInformeBorrador(email, nombreCliente, tipoInforme, version) {
  const casoUrl = `${SITE_URL}/portal/dashboard`;
  return enviar({
    to: email,
    subject: 'Tu informe está listo para revisión — Tu Asesor Social',
    text: `Hola ${nombreCliente},\n\nSubimos el borrador (versión ${version}) de tu informe de ${tipoInforme}. Revísalo en tu portal y cuéntanos si estás conforme o si necesitas cambios:\n\n${casoUrl}\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${nombreCliente}</strong>,</p>
      <p style="margin:0 0 16px;">Subimos el <strong>borrador (versión ${version})</strong> de tu informe de <strong>${tipoInforme}</strong>. Revísalo en tu portal y cuéntanos si estás conforme o si necesitas cambios.</p>
      ${botonHtml('Revisar mi informe', casoUrl)}
    `),
  });
}

function avisarInformeOficial(email, nombreCliente, tipoInforme) {
  const casoUrl = `${SITE_URL}/portal/dashboard`;
  return enviar({
    to: email,
    subject: 'Tu informe oficial ya está disponible — Tu Asesor Social',
    text: `Hola ${nombreCliente},\n\nYa puedes descargar tu informe oficial de ${tipoInforme}, firmado con firma electrónica, desde tu portal:\n\n${casoUrl}\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${nombreCliente}</strong>,</p>
      <p style="margin:0 0 16px;">Tu <strong>informe oficial de ${tipoInforme}</strong>, firmado con firma electrónica, ya está disponible para descargar.</p>
      ${botonHtml('Descargar mi informe', casoUrl)}
    `),
  });
}

function confirmarCitaCliente(email, nombreCliente, fechaFormateada, horaFormateada, duracionMinutos) {
  const agendaUrl = `${SITE_URL}/portal/agenda`;
  return enviar({
    to: email,
    subject: 'Tu hora quedó confirmada — Tu Asesor Social',
    text: `Hola ${nombreCliente},\n\nTu hora quedó confirmada para el ${fechaFormateada} a las ${horaFormateada} (duración aproximada: ${duracionMinutos} minutos).\n\nSi necesitas cancelarla, puedes hacerlo desde tu portal:\n\n${agendaUrl}\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${nombreCliente}</strong>,</p>
      <p style="margin:0 0 8px;">Tu hora quedó confirmada:</p>
      <div style="background:#f8fafc;border-radius:12px;padding:18px 22px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Fecha y hora</p>
        <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#1f2937;">${fechaFormateada}, ${horaFormateada}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Duración aproximada</p>
        <p style="margin:0;font-size:17px;font-weight:700;color:#1f2937;">${duracionMinutos} minutos</p>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Si necesitas cancelarla, puedes hacerlo desde tu portal.</p>
      ${botonHtml('Ver mi agenda', agendaUrl)}
    `),
  });
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pesos(n) {
  return '$' + Number(n || 0).toLocaleString('es-CL');
}

// pago: null si la hora no exige abono, o { monto, estado: 'pendiente' }.
function avisarNuevaCitaAdmin(emailTrabajadorSocial, nombreCliente, fechaFormateada, horaFormateada, duracionMinutos, motivo, pago, servicio) {
  const citasUrl = `${SITE_URL}/admin/citas`;
  const notaPago = pago
    ? `Reserva pendiente: el cliente debe abonar ${pesos(pago.monto)} (50%). Cuando recibas la transferencia, confírmala en el panel (la hora queda retenida 15 minutos).`
    : 'Hora confirmada (sin abono requerido).';
  return enviar({
    interno: true,
    to: emailTrabajadorSocial,
    subject: `${nombreCliente} ${pago ? 'reservó una hora (pendiente de pago)' : 'agendó una hora'}`,
    text: `${nombreCliente} reservó una hora para el ${fechaFormateada} a las ${horaFormateada} (${duracionMinutos} minutos).\n\nServicio: ${servicio || 'No indicado'}\nDetalle: ${motivo || 'Sin detalle'}\n\n${notaPago}\n\nRevisa tu agenda:\n\n${citasUrl}`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;"><strong>${esc(nombreCliente)}</strong> reservó una hora.</p>
      <div style="background:#f8fafc;border-radius:12px;padding:18px 22px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Fecha y hora</p>
        <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#1f2937;">${fechaFormateada}, ${horaFormateada}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Duración aproximada</p>
        <p style="margin:0 0 14px;font-size:17px;font-weight:700;color:#1f2937;">${duracionMinutos} minutos</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Servicio</p>
        <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1f2937;">${esc(servicio) || 'No indicado'}</p>
        <p style="margin:0 0 4px;font-size:12px;color:#64748b;">Detalle de la consulta</p>
        <p style="margin:0;font-size:15px;color:#1f2937;white-space:pre-wrap;">${esc(motivo) || 'Sin detalle'}</p>
      </div>
      <p style="margin:0 0 8px;font-size:14px;color:#475569;">${notaPago}</p>
      ${botonHtml('Ver mi agenda', citasUrl)}
    `),
  });
}

// Instrucciones de transferencia para el cliente que reservó una hora con abono.
function instruccionesPagoCliente(email, nombreCliente, fechaFormateada, horaFormateada, datos) {
  const agendaUrl = `${SITE_URL}/portal/agenda`;
  const lineas = [
    ['Banco', datos.banco], ['Tipo de cuenta', datos.tipo_cuenta], ['N° de cuenta', datos.numero_cuenta],
    ['Titular', datos.titular], ['RUT', datos.rut_titular], ['Correo', datos.email_pago],
  ].filter(([, v]) => v);
  const filasHtml = lineas.map(([k, v]) => `<p style="margin:0 0 2px;font-size:12px;color:#64748b;">${k}</p><p style="margin:0 0 10px;font-size:15px;font-weight:700;color:#1f2937;">${esc(v)}</p>`).join('');
  const filasTexto = lineas.map(([k, v]) => `${k}: ${v}`).join('\n');
  return enviar({
    to: email,
    subject: `Tu hora está reservada por 15 minutos: falta el abono — Tu Asesor Social`,
    text: `Hola ${nombreCliente},\n\nReservamos tu hora para el ${fechaFormateada} a las ${horaFormateada}. Para confirmarla, transfiere el 50% (${pesos(datos.monto)}) a:\n\n${filasTexto}\n\nUsa como referencia el código ${datos.codigo}. La hora queda retenida ${datos.minutosRetencion} minutos. Luego entra a tu portal y pulsa "Ya hice la transferencia":\n\n${agendaUrl}\n\nSaludos,\nTu Asesor Social`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;">Hola <strong>${esc(nombreCliente)}</strong>,</p>
      <p style="margin:0 0 8px;">Reservamos tu hora para el <strong>${fechaFormateada}, ${horaFormateada}</strong>. Para confirmarla, transfiere el 50% (<strong>${pesos(datos.monto)}</strong>):</p>
      <div style="background:#f8fafc;border-radius:12px;padding:18px 22px;margin:20px 0;">${filasHtml}
        <p style="margin:0 0 2px;font-size:12px;color:#64748b;">Referencia / comentario</p>
        <p style="margin:0;font-size:15px;font-weight:700;font-family:monospace;color:#1f2937;">${datos.codigo}</p>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#64748b;">Tu hora queda retenida ${datos.minutosRetencion} minutos. Después de transferir, entra a tu portal y pulsa “Ya hice la transferencia”.</p>
      ${botonHtml('Ir a mi agenda', agendaUrl)}
    `),
  });
}

function avisarPagoInformadoAdmin(emailTrabajadorSocial, nombreCliente, fechaFormateada, horaFormateada, monto) {
  const citasUrl = `${SITE_URL}/admin/citas`;
  return enviar({
    interno: true,
    to: emailTrabajadorSocial,
    subject: `${nombreCliente} informó su transferencia`,
    text: `${nombreCliente} dice haber transferido ${pesos(monto)} para la hora del ${fechaFormateada} a las ${horaFormateada}. Revisa tu cuenta y confirma el pago en el panel:\n\n${citasUrl}`,
    html: plantillaHtml(`
      <p style="margin:0 0 16px;"><strong>${esc(nombreCliente)}</strong> informó que transfirió <strong>${pesos(monto)}</strong> para la hora del <strong>${fechaFormateada}, ${horaFormateada}</strong>.</p>
      <p style="margin:0 0 8px;font-size:14px;color:#475569;">Revisa que el dinero haya llegado a tu cuenta y confirma la recepción en el panel para aprobar la reserva.</p>
      ${botonHtml('Confirmar pago', citasUrl)}
    `),
  });
}

module.exports = {
  mailer,
  enviar,
  motivoUltimoFallo,
  avisarActualizacionCaso,
  bienvenidaCliente,
  avisarRespuestaCliente,
  avisarInformeBorrador,
  avisarInformeOficial,
  confirmarCitaCliente,
  avisarNuevaCitaAdmin,
  instruccionesPagoCliente,
  avisarPagoInformadoAdmin,
};
