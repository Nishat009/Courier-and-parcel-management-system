const assertPoisha = (amount) => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    const error = new Error('Money amounts must be non-negative integer poisha');
    error.code = 'INVALID_MONEY';
    error.status = 400;
    throw error;
  }
  return amount;
};

const currencyFormatter = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeNumberFormatter = new Intl.NumberFormat('en-BD', { useGrouping: true, maximumFractionDigits: 0 });
const formatBdt = (poisha) => {
  if (!Number.isSafeInteger(poisha)) throw new TypeError('BDT display values must be safe integer poisha');
  const units = BigInt(poisha);
  const negative = units < 0n;
  const absoluteUnits = negative ? -units : units;
  const whole = absoluteUnits / 100n;
  const fraction = (absoluteUnits % 100n).toString().padStart(2, '0');
  return currencyFormatter.formatToParts(negative ? -1n : 1n).map((part) => {
    if (part.type === 'integer') return wholeNumberFormatter.format(whole);
    if (part.type === 'fraction') return fraction;
    return part.value;
  }).join('');
};

module.exports = { assertPoisha, formatBdt };
