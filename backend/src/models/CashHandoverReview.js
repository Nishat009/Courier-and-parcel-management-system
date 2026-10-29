const mongoose = require('mongoose');

const cashHandoverReviewSchema = new mongoose.Schema({
  handoverId: { type: mongoose.Schema.Types.ObjectId, ref: 'CashHandover', required: true, index: true },
  attemptNumber: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  expectedAmountPoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  verifiedAmountPoisha: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  outcome: { type: String, enum: ['matched', 'disputed'], required: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

cashHandoverReviewSchema.index({ handoverId: 1, attemptNumber: 1 }, { unique: true });
cashHandoverReviewSchema.pre('save', function rejectMutation() {
  if (!this.isNew) throw new Error('Cash handover reviews are append-only');
});
for (const hook of ['findOneAndUpdate', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne', 'findOneAndReplace', 'bulkWrite']) {
  cashHandoverReviewSchema.pre(hook, function rejectMutation() {
    throw new Error('Cash handover reviews are append-only');
  });
}

module.exports = mongoose.model('CashHandoverReview', cashHandoverReviewSchema);
