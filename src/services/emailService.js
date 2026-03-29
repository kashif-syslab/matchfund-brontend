const nodemailer = require('nodemailer');

/**
 * Optional transactional email (signup verification). If SMTP_* is unset, nothing is sent.
 * Gmail: use an App Password, port 587, and leave SMTP unset or false for STARTTLS (see .env.example).
 */
function isSmtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  if (!isSmtpConfigured()) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  // 465 = TLS from the start; 587 = STARTTLS (nodemailer expects secure: false).
  const secure =
    port === 465 || (process.env.SMTP_SECURE === 'true' && port !== 587);

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * @param {string} to
 * @param {string} token
 * @returns {Promise<{ sent: boolean }>}
 */
async function sendVerificationEmail(to, token) {
  const transport = createTransport();
  if (!transport) {
    return { sent: false };
  }

  const base = (process.env.CLIENT_ORIGIN || 'http://localhost:3000').replace(/\/$/, '');
  const link = `${base}/auth/verify-email?token=${encodeURIComponent(token)}`;
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const accent = '#ea580c';

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#faf8f5;">
  <p style="margin:0 0 16px;">Thanks for signing up for <strong>MatchFund</strong>.</p>
  <p style="margin:0 0 20px;">Confirm your email to get started:</p>
  <p style="margin:0 0 24px;">
    <a href="${link}" style="display:inline-block;background:${accent};color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:600;">Verify your email</a>
  </p>
  <p style="margin:0 0 8px;font-size:14px;color:#666;">If the button doesn’t work, copy this link into your browser:</p>
  <p style="margin:0;font-size:13px;word-break:break-all;color:#444;">${link}</p>
</body>
</html>`;

  await transport.sendMail({
    from: `"MatchFund" <${from}>`,
    to,
    subject: 'Verify your MatchFund email',
    text: `Thanks for signing up for MatchFund.\n\nVerify your email by opening this link in your browser:\n${link}\n`,
    html,
  });
  return { sent: true };
}

module.exports = {
  isSmtpConfigured,
  sendVerificationEmail,
};
