const parsePagination = (query, { defaultLimit = 25, maxLimit = 100 } = {}) => {
  const parse = (value, fallback) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };

  const page = parse(query.page, 1);
  const requestedLimit = parse(query.limit, defaultLimit);
  if (!page || !requestedLimit) return null;
  const limit = Math.min(maxLimit, requestedLimit);
  const skip = (page - 1) * limit;
  if (!Number.isSafeInteger(skip)) return null;
  return { page, limit, skip };
};

module.exports = { parsePagination };
