const NotificationOutbox = require('../models/NotificationOutbox');

module.exports = {
  name: '003-notification-outbox',
  async up() {
    await NotificationOutbox.createIndexes();
  }
};
