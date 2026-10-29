const INVALID_QUERY_STRING = Symbol('INVALID_QUERY_STRING');

const optionalQueryString = (value, maxLength) => {
  if (value === undefined) return '';
  if (typeof value !== 'string') return INVALID_QUERY_STRING;
  const normalized = value.trim();
  if (normalized.length > maxLength) return INVALID_QUERY_STRING;
  return normalized;
};

module.exports = { optionalQueryString, INVALID_QUERY_STRING };
