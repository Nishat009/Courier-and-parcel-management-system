const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, select: false },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.model('Session', sessionSchema);
