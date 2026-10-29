const mongoose = require('mongoose');
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'operations', 'accounts', 'merchant', 'rider', 'agent', 'customer'], default: 'customer', index: true },
  accountStatus: { type: String, enum: ['pending', 'active', 'rejected', 'suspended'], default: 'active', index: true },
  branchIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
  phone: { type: String, trim: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', userSchema);
