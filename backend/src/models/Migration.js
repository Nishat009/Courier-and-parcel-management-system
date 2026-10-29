const mongoose = require('mongoose');

module.exports = mongoose.model('Migration', new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  appliedAt: { type: Date, default: Date.now },
  checksum: { type: String, required: true }
}, { versionKey: false }));
