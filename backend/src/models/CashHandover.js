const mongoose = require('mongoose');

const cashHandoverSchema = new mongoose.Schema({
  riderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
  parcelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', required: true }],
  expectedAmountPoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  declaredAmountPoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  verifiedAmountPoisha: { type: Number, min: 0, validate: Number.isSafeInteger },
  status: { type: String, enum: ['submitted', 'reconciled', 'disputed'], default: 'submitted', index: true },
  submittedAt: { type: Date, default: Date.now },
  verifiedAt: Date,
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  idempotencyKey: { type: String, required: true },
  note: { type: String, maxlength: 1000 }
}, { timestamps: true });

cashHandoverSchema.index({ riderId: 1, idempotencyKey: 1 }, { unique: true });
cashHandoverSchema.index({ branchId: 1, status: 1, submittedAt: -1 });

module.exports = mongoose.model('CashHandover', cashHandoverSchema);
