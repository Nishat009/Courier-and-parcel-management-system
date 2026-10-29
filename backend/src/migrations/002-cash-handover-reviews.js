const CashHandoverReview = require('../models/CashHandoverReview');

module.exports = {
  name: '002-cash-handover-reviews',
  async up() {
    await CashHandoverReview.createIndexes();
  }
};
