const { assertPoisha } = require('./money');

const readNonNegativeInt = (env, fallback) => {
  const value = env == null || env === '' ? fallback : Number(env);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Pricing configuration must use non-negative integer poisha/basis points');
  return value;
};

const getPricingConfig = (env = process.env) => ({
  sameBranchFeePoisha: readNonNegativeInt(env.DELIVERY_FEE_SAME_BRANCH_POISHA, 6000),
  interBranchFeePoisha: readNonNegativeInt(env.DELIVERY_FEE_INTER_BRANCH_POISHA, 10000),
  codFeeBasisPoints: Math.min(10000, readNonNegativeInt(env.COD_FEE_BASIS_POINTS, 100))
});

const priceBooking = ({ codAmountPoisha = 0, isInterBranch, config = getPricingConfig() }) => {
  assertPoisha(codAmountPoisha);
  if (typeof isInterBranch !== 'boolean') throw new Error('isInterBranch must be explicit');
  const deliveryFeePoisha = isInterBranch ? config.interBranchFeePoisha : config.sameBranchFeePoisha;
  const codFeePoisha = Number((BigInt(codAmountPoisha) * BigInt(config.codFeeBasisPoints) + 5000n) / 10000n);
  const merchantNetPoisha = Number(BigInt(codAmountPoisha) - BigInt(deliveryFeePoisha) - BigInt(codFeePoisha));
  return Object.freeze({
    currency: 'BDT',
    deliveryFeePoisha,
    codAmountPoisha,
    codFeeBasisPoints: config.codFeeBasisPoints,
    codFeePoisha,
    merchantNetPoisha: Math.max(0, merchantNetPoisha)
  });
};

module.exports = { getPricingConfig, priceBooking };
