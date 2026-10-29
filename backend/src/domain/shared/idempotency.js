const crypto = require('node:crypto');

const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const hashRequest = (value) => crypto.createHash('sha256').update(stableValue(value)).digest('hex');
const validateIdempotencyKey = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value);

module.exports = { hashRequest, validateIdempotencyKey };
