const mongoose = require('mongoose');

const pricingPolicySchema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  sameBranchFeePoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  interBranchFeePoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  codFeeBasisPoints: { type: Number, required: true, min: 0, max: 10000, validate: Number.isSafeInteger },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  updatedAt: { type: Date, default: Date.now },
  history: [{
    sameBranchFeePoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    interBranchFeePoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    codFeeBasisPoints: { type: Number, required: true, min: 0, max: 10000, validate: Number.isSafeInteger },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    changedAt: { type: Date, required: true }
  }]
}, { versionKey: false });

module.exports = mongoose.model('PricingPolicy', pricingPolicySchema);
