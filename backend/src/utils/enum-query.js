const INVALID_ENUM_QUERY = Symbol('INVALID_ENUM_QUERY');

const enumQuery = (value, allowedValues, defaultValue) => {
  if (value === undefined || value === '') return defaultValue;
  if (typeof value !== 'string' || !allowedValues.includes(value)) return INVALID_ENUM_QUERY;
  return value;
};

module.exports = { enumQuery, INVALID_ENUM_QUERY };
