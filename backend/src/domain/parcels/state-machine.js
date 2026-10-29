const states = Object.freeze([
  'Processing',
  'Booked',
  'Picked Up',
  'At Origin Hub',
  'In Transit',
  'At Destination Hub',
  'Out for Delivery',
  'Delivered',
  'Delivery Failed',
  'Cancelled'
]);

const transitions = Object.freeze({
  Processing: { Booked: ['admin', 'operations'], Cancelled: ['admin', 'operations'] },
  Booked: { 'Picked Up': ['rider', 'operations', 'admin'], Cancelled: ['admin', 'operations'] },
  'Picked Up': { 'At Origin Hub': ['rider', 'operations', 'admin'] },
  'At Origin Hub': { 'In Transit': ['operations', 'admin'] },
  'In Transit': { 'At Destination Hub': ['operations', 'admin'] },
  'At Destination Hub': { 'Out for Delivery': ['rider', 'operations', 'admin'] },
  'Out for Delivery': { Delivered: ['rider', 'operations', 'admin'], 'Delivery Failed': ['rider', 'operations', 'admin'] },
  'Delivery Failed': { 'Out for Delivery': ['operations', 'admin'], Cancelled: ['operations', 'admin'] },
  Delivered: {},
  Cancelled: {}
});

const canTransition = ({ from, to, role }) => Boolean(transitions[from]?.[to]?.includes(role));

const assertTransition = ({ from, to, role }) => {
  if (!states.includes(from) || !states.includes(to)) {
    const error = new Error('Unknown parcel operational state');
    error.code = 'INVALID_STATE';
    throw error;
  }
  if (!canTransition({ from, to, role })) {
    const error = new Error(`Role ${role} cannot move parcel from ${from} to ${to}`);
    error.code = 'INVALID_TRANSITION';
    throw error;
  }
};

module.exports = { states, transitions, canTransition, assertTransition };
