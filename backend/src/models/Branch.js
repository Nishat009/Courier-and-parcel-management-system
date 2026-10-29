const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
  code: { type: String, required: true, uppercase: true, trim: true, unique: true },
  name: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true, index: true },
  address: { type: String, required: true, trim: true },
  phone: { type: String, trim: true },
  active: { type: Boolean, default: true, index: true },
  bookingRevision: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Branch', branchSchema);
