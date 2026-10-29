const nodemailer = require('nodemailer');

const createEmailProvider = (env = process.env) => {
  if (!env.NODEMAILER_EMAIL || !env.NODEMAILER_PASS) {
    return { configured: false, async send() { return { accepted: false, status: 'not_configured' }; } };
  }
  const transporter = nodemailer.createTransport({ service: env.EMAIL_SERVICE || 'gmail', auth: { user: env.NODEMAILER_EMAIL, pass: env.NODEMAILER_PASS } });
  return {
    configured: true,
    async send({ to, subject, text }) {
      const result = await transporter.sendMail({ from: env.NODEMAILER_EMAIL, to, subject, text });
      return { accepted: result.accepted?.includes(to) || false, status: result.accepted?.includes(to) ? 'accepted_by_smtp' : 'rejected_by_smtp', messageId: result.messageId };
    }
  };
};

module.exports = { createEmailProvider };
