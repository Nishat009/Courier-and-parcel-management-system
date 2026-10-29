const createSmsProvider = ({ adapter } = {}) => ({
  configured: Boolean(adapter),
  async send(message) {
    if (!adapter) return { accepted: false, status: 'not_configured' };
    return adapter.send(message);
  }
});

module.exports = { createSmsProvider };
