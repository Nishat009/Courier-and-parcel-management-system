const { assertPoisha } = require('./money');

const ruleError = (code, message, status = 409) => Object.assign(new Error(message), { code, status });

const assertExactCollection = (expectedPoisha, collectedPoisha) => {
  assertPoisha(expectedPoisha);
  assertPoisha(collectedPoisha);
  if (expectedPoisha !== collectedPoisha) throw ruleError('COD_AMOUNT_MISMATCH', 'Collected cash must match the booking COD amount exactly');
  return true;
};

const handoverMatches = (expectedPoisha, verifiedPoisha) => {
  assertPoisha(expectedPoisha);
  assertPoisha(verifiedPoisha);
  return expectedPoisha === verifiedPoisha;
};

const assertPayoutAction = ({ action, role, status, paymentReference, note }) => {
  if (!['admin', 'accounts'].includes(role)) throw ruleError('FORBIDDEN_SCOPE', 'Accounts permission is required', 403);
  if (['approve', 'reject'].includes(action)) {
    if (status !== 'requested') throw ruleError('PAYOUT_CONFLICT', 'Payout is no longer awaiting review');
    if (action === 'reject' && (typeof note !== 'string' || note.trim().length < 8 || note.trim().length > 1000)) {
      throw ruleError('PAYOUT_REJECTION_NOTE_REQUIRED', 'Explain the payout rejection in 8 to 1000 characters', 400);
    }
    return true;
  }
  if (action === 'mark-paid') {
    if (status !== 'approved') throw ruleError('PAYOUT_CONFLICT', 'Payout is no longer approved');
    if (typeof paymentReference !== 'string' || paymentReference.trim().length < 3 || paymentReference.trim().length > 120) throw ruleError('PAYMENT_REFERENCE_REQUIRED', 'Record the confirmed bank/MFS reference before marking the payout paid');
    return true;
  }
  if (action === 'reverse') {
    if (role !== 'admin') throw ruleError('FORBIDDEN_SCOPE', 'Only an admin can reverse a confirmed payout', 403);
    if (status !== 'paid') throw ruleError('PAYOUT_CONFLICT', 'Only a paid payout can be reversed');
    if (typeof paymentReference !== 'string' || paymentReference.trim().length < 3 || paymentReference.trim().length > 120) throw ruleError('REVERSAL_REFERENCE_REQUIRED', 'Record the confirmed bank/MFS return reference before reversing this payout');
    if (typeof note !== 'string' || note.trim().length < 8) throw ruleError('REVERSAL_NOTE_REQUIRED', 'Explain the confirmed payout reversal');
    return true;
  }
  throw ruleError('INVALID_PAYOUT_ACTION', 'Unknown payout action', 400);
};

const assertCodPayableReversal = ({ role, entryType, note, blockingPayout }) => {
  if (role !== 'admin') throw ruleError('FORBIDDEN_SCOPE', 'Only an admin can reverse a COD payable entry', 403);
  if (entryType !== 'cod_payable') throw ruleError('INVALID_REVERSAL', 'Only a COD payable entry can be reversed');
  if (blockingPayout) throw ruleError('PAYOUT_CONFLICT', 'Reverse or reject the related payout before reversing this payable entry');
  if (typeof note !== 'string' || note.trim().length < 8) throw ruleError('REVERSAL_NOTE_REQUIRED', 'Explain the COD payable reversal');
  return true;
};

module.exports = { assertExactCollection, handoverMatches, assertPayoutAction, assertCodPayableReversal };
