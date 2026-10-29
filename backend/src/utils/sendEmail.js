const { createEmailProvider } = require('../providers/email');

const sendEmail = async (to, subject, text) => {
  return createEmailProvider().send({ to, subject, text });
};

module.exports = sendEmail;
