const mongoose = require('mongoose');

const transactionSupport = (connection = mongoose.connection) => {
  if (connection.readyState !== 1) return { supported: false, reason: 'MongoDB is not connected' };
  const type = connection.client?.topology?.description?.type;
  if (!['ReplicaSetWithPrimary', 'Sharded', 'LoadBalanced'].includes(type)) {
    return { supported: false, reason: 'MongoDB transactions require a replica set or sharded cluster' };
  }
  return { supported: true, reason: null };
};

const inTransaction = async (work) => {
  const capability = transactionSupport();
  if (!capability.supported) throw Object.assign(new Error(capability.reason), { code: 'TRANSACTIONS_UNAVAILABLE', status: 503 });
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
};

module.exports = { inTransaction, transactionSupport };
