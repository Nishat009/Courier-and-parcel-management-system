const mongoose = require('mongoose');

const idempotencyRecordSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  operation: { type: String, required: true },
  key: { type: String, required: true },
  requestHash: { type: String, required: true },
  resourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

idempotencyRecordSchema.index({ actorId: 1, operation: 1, key: 1 }, { unique: true });
module.exports = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
