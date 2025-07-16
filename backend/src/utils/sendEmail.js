const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, text) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.NODEMAILER_EMAIL,
      pass: process.env.NODEMAILER_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.NODEMAILER_EMAIL,
    to,
    subject,
    text
  });
};

module.exports = sendEmail;