const express = require('express');
const bcrypt = require('bcryptjs');
const Parcel = require('../models/Parcel');
const User = require('../models/User');
const Branch = require('../models/Branch');
const CashHandover = require('../models/CashHandover');
const PricingPolicy = require('../models/PricingPolicy');
const NotificationOutbox = require('../models/NotificationOutbox');
const { createEmailProvider } = require('../providers/email');
const Session = require('../models/Session');
const { getPricingConfig } = require('../domain/finance/pricing');
const { inTransaction } = require('../domain/shared/transaction');
const { attachProofMetadata } = require('../utils/delivery-proofs');
const { enumQuery, INVALID_ENUM_QUERY } = require('../utils/enum-query');
const { parsePagination } = require('../utils/pagination');
const { optionalQueryString, INVALID_QUERY_STRING } = require('../utils/query-string');
const { dhakaDayStart } = require('../domain/shared/datetime');
const auth = require('../middleware/auth');
const router = express.Router();

router.get('/pricing', auth(['admin']), async (req, res) => {
  try {
    const saved = await PricingPolicy.findById('default').populate('history.changedBy', 'name').lean();
    const config = saved || getPricingConfig();
    res.json({
      sameBranchFeePoisha: config.sameBranchFeePoisha,
      interBranchFeePoisha: config.interBranchFeePoisha,
      codFeeBasisPoints: config.codFeeBasisPoints,
      source: saved ? 'database' : 'environment',
      history: saved?.history || []
    });
  } catch (error) {
    res.status(503).json({ msg: 'Unable to load booking prices' });
  }
});

router.put('/pricing', auth(['admin']), async (req, res) => {
  const { sameBranchFeePoisha, interBranchFeePoisha, codFeeBasisPoints } = req.body || {};
  if (![sameBranchFeePoisha, interBranchFeePoisha, codFeeBasisPoints].every(Number.isSafeInteger) ||
      sameBranchFeePoisha < 0 || interBranchFeePoisha < 0 || codFeeBasisPoints < 0 || codFeeBasisPoints > 10000) {
    return res.status(400).json({ msg: 'Fees must be non-negative integer poisha and COD rate must be between 0 and 10000 basis points' });
  }
  try {
    const changedAt = new Date();
    const policy = await PricingPolicy.findOneAndUpdate(
      { _id: 'default' },
      {
        $set: { sameBranchFeePoisha, interBranchFeePoisha, codFeeBasisPoints, updatedBy: req.user.id, updatedAt: changedAt },
        $push: { history: { sameBranchFeePoisha, interBranchFeePoisha, codFeeBasisPoints, changedBy: req.user.id, changedAt } }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    res.json({
      sameBranchFeePoisha: policy.sameBranchFeePoisha,
      interBranchFeePoisha: policy.interBranchFeePoisha,
      codFeeBasisPoints: policy.codFeeBasisPoints,
      source: 'database',
      updatedAt: policy.updatedAt
    });
  } catch (error) {
    res.status(503).json({ msg: 'Unable to save booking prices' });
  }
});

router.patch('/users/:id/role', auth(['admin']), async (req, res) => {
  const { role } = req.body || {};
  if (!User.base.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ msg: 'Invalid user ID' });
  }
  if (!['admin', 'customer'].includes(role)) {
    return res.status(400).json({ msg: 'Choose either the admin or customer role' });
  }
  if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) {
    return res.status(400).json({ msg: 'You cannot change your own role' });
  }

  try {
    const user = await User.findById(req.params.id).select('_id name email role');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    if (user.role === 'agent') {
      return res.status(400).json({ msg: 'Delivery agent accounts cannot be changed to admin or customer here' });
    }
    if (user.role !== role) {
      user.role = role;
      await user.save();
      // Remove existing sockets from privileged rooms immediately.
      req.io.to(`user:${user._id}`).emit('roleChanged', { role });
      req.io.in(`user:${user._id}`).disconnectSockets(true);
    }
    res.json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    console.error('User role update failed:', err);
    res.status(500).json({ msg: 'Unable to update this user role' });
  }
});

router.patch('/users/:id/access', auth(['admin']), async (req, res) => {
  const { role, branchIds = [] } = req.body || {};
  if (!User.base.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ msg: 'Invalid user ID' });
  if (!['admin', 'operations', 'accounts', 'rider'].includes(role)) return res.status(400).json({ msg: 'Choose an internal staff role' });
  if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) return res.status(400).json({ msg: 'You cannot change your own access' });
  if (!Array.isArray(branchIds) || branchIds.some((id) => !User.base.Types.ObjectId.isValid(id))) return res.status(400).json({ msg: 'Branch access must contain valid branch IDs' });
  try {
    const existing = await User.findById(req.params.id);
    if (!existing) return res.status(404).json({ msg: 'User not found' });
    if (['merchant', 'agent', 'customer'].includes(existing.role)) return res.status(400).json({ msg: 'Merchant review and legacy account roles cannot be changed here; create a new staff account instead' });
    const activeBranches = await Branch.countDocuments({ _id: { $in: branchIds }, active: true });
    if (activeBranches !== new Set(branchIds.map(String)).size) return res.status(400).json({ msg: 'Choose only active branches' });
    const accessChanged = existing.role !== role || (existing.branchIds || []).map(String).sort().join(',') !== branchIds.map(String).sort().join(',');
    existing.role = role;
    existing.branchIds = ['operations', 'accounts', 'rider'].includes(role) ? branchIds : [];
    await existing.save();
    if (accessChanged) {
      req.io.to(`user:${existing._id}`).emit('roleChanged', { role: existing.role });
      req.io.in(`user:${existing._id}`).disconnectSockets(true);
    }
    res.json({ user: { id: String(existing._id), name: existing.name, email: existing.email, role: existing.role, branchIds: existing.branchIds.map(String) } });
  } catch (error) {
    console.error('User access update failed:', error.message);
    res.status(503).json({ msg: 'Unable to update user access' });
  }
});

router.patch('/users/:id/status', auth(['admin']), async (req, res) => {
  const { accountStatus } = req.body || {};
  if (!User.base.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ msg: 'Invalid user ID' });
  if (!['active', 'suspended'].includes(accountStatus)) return res.status(400).json({ msg: 'Choose active or suspended account status' });
  if (req.params.id.toLowerCase() === req.user.id.toLowerCase()) return res.status(400).json({ msg: 'You cannot change your own account status' });
  try {
    const updated = await inTransaction(async (session) => {
      const current = await User.findById(req.params.id).select('_id name email role accountStatus branchIds __v').session(session);
      if (!current) throw Object.assign(new Error('User not found'), { status: 404 });
      if (!['operations', 'accounts', 'rider'].includes(current.role)) throw Object.assign(new Error('Only operations, accounts, or rider accounts can be managed here'), { status: 409 });
      if (current.accountStatus === accountStatus) return current;
      if (accountStatus === 'active') {
        const activeBranches = await Branch.countDocuments({ _id: { $in: current.branchIds }, active: true }).session(session);
        if (!current.branchIds.length || activeBranches !== new Set(current.branchIds.map(String)).size) {
          throw Object.assign(new Error('Restore at least one active branch assignment before reactivating this account'), { status: 409 });
        }
      }
      const changed = await User.findOneAndUpdate(
        { _id: current._id, role: current.role, accountStatus: current.accountStatus, __v: current.__v },
        { $set: { accountStatus }, $inc: { __v: 1 } },
        { new: true, session, runValidators: true }
      );
      if (!changed) throw Object.assign(new Error('Account access changed concurrently; refresh and retry'), { status: 409 });
      if (accountStatus === 'suspended') await Session.deleteMany({ userId: current._id }, { session });
      return changed;
    });
    if (accountStatus === 'suspended') {
      req.io.to(`user:${updated._id}`).emit('roleChanged', { accountStatus });
      req.io.in(`user:${updated._id}`).disconnectSockets(true);
    }
    res.json({ user: { id: String(updated._id), name: updated.name, email: updated.email, role: updated.role, accountStatus: updated.accountStatus, branchIds: updated.branchIds.map(String) } });
  } catch (error) {
    res.status(error.status || 503).json({ msg: error.message || 'Unable to change account status' });
  }
});

router.get('/branches', auth(['admin']), async (req, res) => {
  const branches = await Branch.find().sort({ city: 1, name: 1 }).lean();
  res.json({ items: branches });
});

router.get('/notifications', auth(['admin']), async (req, res) => {
  const pagination = parsePagination(req.query, { defaultLimit: 20 });
  if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
  const { page, limit, skip } = pagination;
  const status = enumQuery(req.query.status, ['pending', 'sending', 'accepted', 'dead_letter']);
  if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid notification status' });
  const filter = status ? { status } : {};
  const [items, total] = await Promise.all([
    NotificationOutbox.find(filter).populate('lastManuallyRetriedBy', 'name').sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    NotificationOutbox.countDocuments(filter)
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit), providerConfigured: createEmailProvider().configured });
});

router.post('/notifications/:id/retry', auth(['admin']), async (req, res) => {
  if (!User.base.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ msg: 'Invalid notification ID' });
  const notification = await NotificationOutbox.findOneAndUpdate(
    { _id: req.params.id, status: 'dead_letter' },
    { $set: { status: 'pending', attempts: 0, nextAttemptAt: new Date(), lastManuallyRetriedBy: req.user.id, lastManuallyRetriedAt: new Date() }, $inc: { manualRetries: 1 }, $unset: { lockUntil: 1 } },
    { new: true }
  );
  if (!notification) return res.status(409).json({ msg: 'Only a dead-letter notification can be retried' });
  res.json({ notification });
});

router.post('/branches', auth(['admin']), async (req, res) => {
  const { code, name, city, address, phone } = req.body || {};
  if (![code, name, city, address].every((value) => typeof value === 'string' && value.trim())) return res.status(400).json({ msg: 'Branch code, name, city, and address are required' });
  try {
    const branch = await Branch.create({ code: code.trim().toUpperCase(), name: name.trim(), city: city.trim(), address: address.trim(), phone: typeof phone === 'string' ? phone.trim() : '' });
    res.status(201).json(branch);
  } catch (error) {
    res.status(error.code === 11000 ? 409 : 400).json({ msg: error.code === 11000 ? 'Branch code already exists' : 'Unable to create branch' });
  }
});

router.patch('/branches/:id', auth(['admin']), async (req, res) => {
  if (!User.base.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ msg: 'Invalid branch ID' });
  const changes = {};
  for (const field of ['name', 'city', 'address', 'phone']) {
    if (Object.hasOwn(req.body || {}, field)) {
      const maximumLength = field === 'address' ? 500 : field === 'phone' ? 32 : 160;
      if (typeof req.body[field] !== 'string' || (field !== 'phone' && !req.body[field].trim()) || req.body[field].trim().length > maximumLength) {
        return res.status(400).json({ msg: `Provide a valid branch ${field}` });
      }
      changes[field] = req.body[field].trim();
    }
  }
  if (Object.hasOwn(req.body || {}, 'active')) {
    if (typeof req.body.active !== 'boolean') return res.status(400).json({ msg: 'Branch active flag must be true or false' });
    changes.active = req.body.active;
  }
  if (!Object.keys(changes).length) return res.status(400).json({ msg: 'Provide branch fields to update' });
  try {
    let branch;
    if (changes.active === false) {
      branch = await inTransaction(async (session) => {
        const current = await Branch.findById(req.params.id).session(session);
        if (!current) throw Object.assign(new Error('Branch not found'), { status: 404, code: 'BRANCH_NOT_FOUND' });
        if (current.active) {
          const openParcels = await Parcel.countDocuments({ $or: [{ originBranchId: current._id }, { destinationBranchId: current._id }], status: { $nin: ['Delivered', 'Cancelled', 'Failed'] } }).session(session);
          const unresolvedHandovers = await CashHandover.countDocuments({ branchId: current._id, status: { $in: ['submitted', 'disputed'] } }).session(session);
          const assignedStaff = await User.exists({ branchIds: current._id, role: { $in: ['operations', 'accounts', 'rider'] } }).session(session);
          if (openParcels || unresolvedHandovers || assignedStaff) {
            throw Object.assign(new Error('Resolve open parcels and cash handovers, then reassign branch staff before deactivation'), { status: 409, code: 'BRANCH_IN_USE' });
          }
        }
        const updated = await Branch.findOneAndUpdate(
          { _id: current._id, __v: current.__v },
          { $set: changes, $inc: { __v: 1 } },
          { new: true, runValidators: true, session }
        );
        if (!updated) throw Object.assign(new Error('Branch changed during deactivation; refresh and retry'), { status: 409, code: 'BRANCH_CONFLICT' });
        return updated;
      });
    } else {
      branch = await Branch.findById(req.params.id);
      if (!branch) return res.status(404).json({ msg: 'Branch not found' });
      Object.assign(branch, changes);
      await branch.save();
    }
    res.json(branch);
  } catch (error) {
    console.error('Branch update failed:', error.message);
    res.status(error.status || 503).json({ msg: error.message || 'Unable to update branch', code: error.code });
  }
});

router.get('/dashboard', auth(['admin']), async (req, res) => {
  try {
    const today = dhakaDayStart();
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    const currentMerchantParcels = { merchantId: { $exists: true }, originBranchId: { $exists: true, $ne: null }, destinationBranchId: { $exists: true, $ne: null } };
    const dailyBookings = await Parcel.countDocuments({
      ...currentMerchantParcels,
      $or: [
        { acceptedAt: { $gte: today, $lt: tomorrow } },
        { acceptedAt: { $exists: false }, status: { $nin: ['Processing', 'Cancelled'] }, createdAt: { $gte: today, $lt: tomorrow } }
      ]
    });
    const processingParcels = await Parcel.countDocuments({ ...currentMerchantParcels, status: 'Processing' });
    const failedDeliveries = await Parcel.countDocuments({ ...currentMerchantParcels, status: 'Delivery Failed' });
    const codAmounts = await Parcel.aggregate([
      { $match: { ...currentMerchantParcels, paymentType: 'COD', status: 'Delivered' } },
      { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    res.json({ dailyBookings, processingParcels, failedDeliveries, codAmounts: codAmounts[0]?.total || 0 });
  } catch (err) {
    console.error('Admin dashboard lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load dashboard metrics' });
  }
});

router.get('/users', auth(['admin']), async (req, res) => {
  try {
    const pagination = parsePagination(req.query, { defaultLimit: 25 });
    if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
    const { page, limit, skip } = pagination;
    const role = enumQuery(req.query.role, ['admin', 'operations', 'accounts', 'merchant', 'rider', 'agent', 'customer']);
    if (role === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid account role' });
    const filter = role ? { role } : {};
    const search = optionalQueryString(req.query.q, 100);
    if (search === INVALID_QUERY_STRING) return res.status(400).json({ msg: 'User search must be one value of at most 100 characters' });
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ name: { $regex: `^${escaped}`, $options: 'i' } }, { email: { $regex: `^${escaped.toLowerCase()}` } }];
    }
    const [items, total] = await Promise.all([
      User.find(filter).select('-password').populate('branchIds', 'code name city').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter)
    ]);
    res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Admin user lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load users' });
  }
});

router.post('/users', auth(['admin']), async (req, res) => {
  const { name, email, password, role, branchIds = [] } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      typeof email !== 'string' || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ msg: 'Name, valid email, and a password between 12 and 72 bytes are required' });
  }
  if (!['admin', 'operations', 'accounts', 'rider'].includes(role)) return res.status(400).json({ msg: 'Choose an internal staff role' });
  if (!Array.isArray(branchIds) || branchIds.length > 20 || branchIds.some((id) => !User.base.Types.ObjectId.isValid(id))) {
    return res.status(400).json({ msg: 'Branch assignments must contain valid branch IDs' });
  }
  const uniqueBranchIds = [...new Set(branchIds.map(String))];
  if (role === 'admin' && uniqueBranchIds.length) return res.status(400).json({ msg: 'Administrator accounts cannot be branch-scoped' });
  if (['operations', 'accounts', 'rider'].includes(role) && !uniqueBranchIds.length) {
    return res.status(400).json({ msg: 'Assign at least one active branch to this staff role' });
  }
  try {
    if (uniqueBranchIds.length) {
      const activeBranches = await Branch.countDocuments({ _id: { $in: uniqueBranchIds }, active: true });
      if (activeBranches !== uniqueBranchIds.length) return res.status(400).json({ msg: 'Choose only active branches' });
    }
    const user = await User.create({
      name: name.trim(), email: email.trim().toLowerCase(), password: await bcrypt.hash(password, 12),
      role, accountStatus: 'active', branchIds: uniqueBranchIds
    });
    res.status(201).json({ user: { id: String(user._id), name: user.name, email: user.email, role: user.role, accountStatus: user.accountStatus, branchIds: user.branchIds.map(String) } });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ msg: 'An account already exists for this email' });
    console.error('Staff account creation failed:', error.message);
    res.status(503).json({ msg: 'Unable to create staff account' });
  }
});

router.get('/bookings', auth(['admin']), async (req, res) => {
  try {
    const pagination = parsePagination(req.query, { defaultLimit: 25 });
    if (!pagination) return res.status(400).json({ msg: 'Page and limit must be positive whole numbers' });
    const { page, limit, skip } = pagination;
    const status = enumQuery(req.query.status, ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled', 'Failed']);
    if (status === INVALID_ENUM_QUERY) return res.status(400).json({ msg: 'Choose a valid legacy parcel status' });
    // Preserve historical customer records for reference; current merchant
    // parcels are managed only through the branch-aware operations workflow.
    const filter = { customerId: { $exists: true }, originBranchId: { $exists: false }, destinationBranchId: { $exists: false } };
    if (status) filter.status = status;
    const [items, total] = await Promise.all([
      Parcel.find(filter).sort({ createdAt: -1, _id: -1 }).populate('customerId', 'name email role').populate('merchantId', 'name email role').populate('agentId', 'name email').skip(skip).limit(limit).lean(),
      Parcel.countDocuments(filter)
    ]);
    res.json({ items: await attachProofMetadata(items), page, limit, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Admin booking lookup failed:', err);
    res.status(500).json({ msg: 'Unable to load bookings' });
  }
});

module.exports = router; // Ensure this export exists
