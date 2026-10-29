const crypto = require('node:crypto');
const RateLimitBucket = require('../models/RateLimitBucket');

const WINDOW_MS = 15 * 60 * 1000;
const IP_FAILURE_LIMIT = 30;
const IP_EMAIL_FAILURE_LIMIT = 5;

const opaqueKey = (value) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'courier-local-rate-limit')
  .update(value)
  .digest('hex');

const readBucket = (value) => RateLimitBucket.findOne({ _id: opaqueKey(value), expiresAt: { $gt: new Date() } }).lean();

const incrementBucket = async (value, windowMs = WINDOW_MS) => {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const _id = opaqueKey(value);
  const active = await RateLimitBucket.findOneAndUpdate(
    { _id, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true }
  ).lean();
  if (active) return active;
  try {
    return await RateLimitBucket.create({ _id, count: 1, expiresAt });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return RateLimitBucket.findOneAndUpdate(
      { _id },
      [{ $set: {
        count: { $cond: [{ $gt: ['$expiresAt', now] }, { $add: ['$count', 1] }, 1] },
        expiresAt: { $cond: [{ $gt: ['$expiresAt', now] }, '$expiresAt', expiresAt] }
      } }],
      { new: true }
    ).lean();
  }
};

const checkLoginLimit = async ({ ip, email }) => {
  const [ipBucket, identityBucket] = await Promise.all([
    readBucket(`login-ip:${ip}`),
    readBucket(`login-ip-email:${ip}:${email}`)
  ]);
  if ((ipBucket?.count || 0) < IP_FAILURE_LIMIT && (identityBucket?.count || 0) < IP_EMAIL_FAILURE_LIMIT) return { allowed: true };
  const nextReset = Math.max(ipBucket?.expiresAt?.getTime?.() || 0, identityBucket?.expiresAt?.getTime?.() || 0);
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((nextReset - Date.now()) / 1000)) };
};

const recordLoginFailure = async ({ ip, email }) => Promise.all([
  incrementBucket(`login-ip:${ip}`),
  incrementBucket(`login-ip-email:${ip}:${email}`)
]);

const clearIdentityFailures = async ({ ip, email }) => RateLimitBucket.deleteOne({ _id: opaqueKey(`login-ip-email:${ip}:${email}`) });

const consumePublicRequestLimit = async ({ ip, endpoint, maximum, windowMs }) => {
  const bucket = await incrementBucket(`public:${endpoint}:${ip}`, windowMs);
  return {
    allowed: bucket.count <= maximum,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - Date.now()) / 1000))
  };
};

module.exports = { checkLoginLimit, recordLoginFailure, clearIdentityFailures, consumePublicRequestLimit };
