const mongoose = require('mongoose');

const ledgerEntrySchema = new mongoose.Schema({
  merchantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parcelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Parcel', index: true },
  payoutId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payout' },
  type: { type: String, enum: ['cod_payable', 'payout_paid', 'reversal', 'adjustment'], required: true },
  amountPoisha: { type: Number, required: true, validate: Number.isSafeInteger },
  currency: { type: String, enum: ['BDT'], default: 'BDT' },
  idempotencyKey: { type: String, required: true },
  reversesEntryId: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry' },
  externalReference: { type: String, trim: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  note: { type: String, maxlength: 1000 }
}, { timestamps: { createdAt: true, updatedAt: false } });

ledgerEntrySchema.index({ merchantId: 1, createdAt: -1 });
ledgerEntrySchema.index({ type: 1, createdAt: -1, _id: -1 });
ledgerEntrySchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerEntrySchema.index({ reversesEntryId: 1 }, { unique: true, sparse: true });
ledgerEntrySchema.pre('save', function rejectMutation() { if (!this.isNew) throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('findOneAndUpdate', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('updateOne', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('deleteOne', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('updateMany', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('deleteMany', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('findOneAndDelete', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('replaceOne', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('findOneAndReplace', function rejectMutation() { throw new Error('Ledger entries are immutable; append a reversal'); });
ledgerEntrySchema.pre('bulkWrite', function rejectBulkMutation() { throw new Error('Bulk writes cannot mutate immutable ledger entries'); });

module.exports = mongoose.model('LedgerEntry', ledgerEntrySchema);
