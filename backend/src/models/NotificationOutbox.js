const mongoose = require('mongoose');

const notificationOutboxSchema = new mongoose.Schema({
  notificationKey: { type: String, required: true, unique: true },
  channel: { type: String, enum: ['email'], required: true },
  recipient: { type: String, required: true, trim: true, maxlength: 254 },
  template: { type: String, enum: ['merchant_application_received', 'merchant_application_approved', 'merchant_application_rejected', 'merchant_application_suspended'], required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['pending', 'sending', 'accepted', 'dead_letter'], default: 'pending', index: true },
  attempts: { type: Number, default: 0, min: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockUntil: Date,
  providerStatus: { type: String, maxlength: 80 },
  providerMessageId: { type: String, maxlength: 256 },
  providerAcceptedAt: Date,
  lastErrorCode: { type: String, maxlength: 80 },
  manualRetries: { type: Number, default: 0, min: 0 },
  lastManuallyRetriedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastManuallyRetriedAt: Date
}, { timestamps: true });

notificationOutboxSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

module.exports = mongoose.model('NotificationOutbox', notificationOutboxSchema);
