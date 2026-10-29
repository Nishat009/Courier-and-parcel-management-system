const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);
const currencyFormatter = new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wholeNumberFormatter = new Intl.NumberFormat('en-BD', { useGrouping: true, maximumFractionDigits: 0 });

export const integerToDecimalString = (value, decimalPlaces = 2) => {
  if (!Number.isSafeInteger(value) || !Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return null;
  const units = BigInt(value);
  const negative = units < 0n;
  const absoluteUnits = negative ? -units : units;
  const scale = 10n ** BigInt(decimalPlaces);
  const whole = absoluteUnits / scale;
  const remainder = absoluteUnits % scale;
  if (decimalPlaces === 0) return `${negative ? '-' : ''}${whole}`;
  return `${negative ? '-' : ''}${whole}.${remainder.toString().padStart(decimalPlaces, '0')}`;
};

export const formatBdt = (poisha = 0) => {
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

export const decimalToInteger = (value, decimalPlaces = 2) => {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6) return null;
  let text = String(value ?? '').trim();
  if (/^\.\d/.test(text)) text = `0${text}`;
  const pattern = decimalPlaces === 0
    ? /^\d+$/
    : new RegExp(`^\\d+(?:\\.\\d{0,${decimalPlaces}})?$`);
  if (!pattern.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const scale = 10n ** BigInt(decimalPlaces);
  const fractionalUnits = fraction ? BigInt(fraction.padEnd(decimalPlaces, '0')) : 0n;
  const result = BigInt(whole) * scale + fractionalUnits;
  return result <= MAX_SAFE_MINOR_UNITS ? Number(result) : null;
};
