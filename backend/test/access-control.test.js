const assert = require('node:assert/strict');
const { before, after, beforeEach, afterEach, test, mock } = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Parcel = require('../src/models/Parcel');
const createAdmin = require('../src/utils/createAdmin');

const adminId = '507f1f77bcf86cd799439001';
const customerId = '507f1f77bcf86cd799439002';
const secondCustomerId = '507f1f77bcf86cd799439003';
const agentId = '507f1f77bcf86cd799439004';
const parcelId = '507f1f77bcf86cd799439005';
const originalSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'isolated-role-permission-test-secret';
let server, baseUrl, accounts, events;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.io = {
      to: (room) => ({ emit: (event, data) => events.push({ room, event, data }) }),
      in: (room) => ({ disconnectSockets: () => events.push({ room, disconnected: true }) })
    };
    next();
  });
  app.use('/api/auth', require('../src/routes/auth'));
  app.use('/api/admin', require('../src/routes/admin'));
  app.use('/api/parcel', require('../src/routes/parcel'));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  accounts = new Map([
    [adminId, { _id: adminId, name: 'Admin', email: 'admin@example.com', role: 'admin' }],
    [customerId, { _id: customerId, name: 'Customer', email: 'customer@example.com', role: 'customer' }],
    [secondCustomerId, { _id: secondCustomerId, name: 'Other Customer', email: 'other@example.com', role: 'customer' }],
    [agentId, { _id: agentId, name: 'Agent', email: 'agent@example.com', role: 'agent' }]
  ]);
  for (const account of accounts.values()) account.save = async () => account;
  events = [];
  mock.method(User, 'findById', (id) => ({ select: async () => accounts.get(id) || null }));
});

afterEach(() => mock.restoreAll());
after(async () => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

const token = (id, role) => jwt.sign({ id, role: role || accounts.get(id)?.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
const request = async (route, { id, method = 'GET', body, bearer } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(id || bearer ? { Authorization: `Bearer ${bearer || token(id)}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
};

test('every admin operation rejects signed-out users and customers', async () => {
  for (const route of ['/api/admin/dashboard', '/api/admin/users', '/api/admin/bookings']) {
    assert.equal((await request(route)).status, 401);
    assert.equal((await request(route, { id: customerId })).status, 403);
  }
  for (const [route, method, body] of [
    [`/api/admin/users/${secondCustomerId}/role`, 'PATCH', { role: 'admin' }],
    [`/api/parcel/assign/${parcelId}`, 'PUT', { agentId }],
    [`/api/parcel/accept/${parcelId}`, 'PUT', {}]
  ]) {
    assert.equal((await request(route, { method, body })).status, 401);
    assert.equal((await request(route, { id: customerId, method, body })).status, 403);
  }
});

test('admin can view metrics, users, and all bookings', async () => {
  mock.method(Parcel, 'countDocuments', async () => 2);
  mock.method(Parcel, 'aggregate', async () => [{ total: 1 }]);
  mock.method(User, 'find', () => ({ select: async () => [...accounts.values()].map(({ _id, name, email, role }) => ({ _id, name, email, role })) }));
  const query = { sort: () => query, populate: () => query, then: (resolve) => Promise.resolve([{ _id: parcelId }]).then(resolve) };
  mock.method(Parcel, 'find', () => query);
  assert.equal((await request('/api/admin/dashboard', { id: adminId })).status, 200);
  const users = await request('/api/admin/users', { id: adminId });
  assert.equal(users.status, 200);
  assert.equal(users.body.length, 4);
  assert.equal((await request('/api/admin/bookings', { id: adminId })).status, 200);
});

test('customer parcel queries are scoped to their own identity, ignoring query overrides', async () => {
  const lookup = mock.method(Parcel, 'find', () => ({ sort: async () => [{ _id: parcelId, customerId }] }));
  const result = await request(`/api/parcel/my-parcels?customerId=${secondCustomerId}`, { id: customerId });
  assert.equal(result.status, 200);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], { customerId });
  assert.equal((await request('/api/parcel/my-parcels', { id: adminId })).status, 403);
  assert.equal((await request('/api/parcel/assigned', { id: customerId })).status, 403);
  assert.equal((await request(`/api/parcel/status/${parcelId}`, { id: customerId, method: 'PUT', body: { status: 'Delivered' } })).status, 403);
});

test('parcel booking cannot impersonate another customer or inject status', async () => {
  const saved = mock.method(Parcel.prototype, 'save', async function () { return this; });
  const body = { pickupAddress: 'Dhaka', deliveryAddress: 'Sylhet', parcelType: 'Books', paymentType: 'COD', customerId: secondCustomerId, status: 'Booked', acceptedBy: customerId, acceptedAt: new Date().toISOString(), qrCode: 'fake-confirmation' };
  const result = await request('/api/parcel/book', { id: customerId, method: 'POST', body });
  assert.equal(result.status, 201);
  assert.equal(result.body.customerId, customerId);
  assert.equal(result.body.status, 'Processing');
  assert.equal(result.body.qrCode, undefined);
  assert.equal(result.body.acceptedAt, undefined);
  assert.equal(result.body.acceptedBy, undefined);
  assert.deepEqual(events, [{ room: 'admins', event: 'parcelRequested', data: { _id: saved.mock.calls[0].this._id } }]);
  assert.equal(saved.mock.callCount(), 1);
  assert.equal((await request('/api/parcel/book', { id: adminId, method: 'POST', body })).status, 403);
});

test('only an admin can accept a request; approval records identity, time, QR and live updates', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async (filter, changes) => {
    assert.deepEqual(filter, { _id: parcelId, status: 'Processing' });
    return { _id: parcelId, customerId, ...changes.$set };
  });
  assert.equal((await request(`/api/parcel/accept/${parcelId}`, { id: agentId, method: 'PUT' })).status, 403);
  assert.equal(update.mock.callCount(), 0);
  const result = await request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT', body: { status: 'Delivered', acceptedBy: customerId } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'Booked');
  assert.equal(result.body.acceptedBy, adminId);
  assert.ok(Date.parse(result.body.acceptedAt));
  assert.match(result.body.qrCode, /^data:image\/png;base64,/);
  assert.deepEqual(events.map(({ room, event, data }) => ({ room, event, status: data.status })), [
    { room: `customer:${customerId}`, event: 'statusUpdate', status: 'Booked' },
    { room: 'admins', event: 'statusUpdate', status: 'Booked' }
  ]);
});

test('repeated or concurrent acceptance attempts do not overwrite a confirmed booking', async () => {
  let status = 'Processing';
  const update = mock.method(Parcel, 'findOneAndUpdate', async (filter, changes) => {
    if (filter.status !== status) return null;
    status = changes.$set.status;
    return { _id: parcelId, customerId, ...changes.$set };
  });
  mock.method(Parcel, 'exists', async () => ({ _id: parcelId }));
  const results = await Promise.all([1, 2].map(() => request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT' })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(events.length, 2);
  assert.equal(status, 'Booked');
  assert.equal(update.mock.callCount(), 2);
});

test('acceptance rejects invalid IDs, missing parcels, and parcels already in delivery', async () => {
  const update = mock.method(Parcel, 'findOneAndUpdate', async () => null);
  const exists = mock.method(Parcel, 'exists', async () => null);
  assert.equal((await request('/api/parcel/accept/invalid', { id: adminId, method: 'PUT' })).status, 400);
  assert.equal(update.mock.callCount(), 0);
  assert.equal((await request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT' })).status, 404);
  exists.mock.mockImplementation(async () => ({ _id: parcelId }));
  assert.equal((await request(`/api/parcel/accept/${parcelId}`, { id: adminId, method: 'PUT' })).status, 409);
  assert.equal(events.length, 0);
});

test('agent assignment requires acceptance and succeeds after the booking is confirmed', async () => {
  mock.method(User, 'findOne', () => ({ select: async () => ({ _id: agentId }) }));
  mock.method(Parcel, 'exists', async () => ({ _id: parcelId }));
  let status = 'Processing';
  mock.method(Parcel, 'findOneAndUpdate', async (filter, changes) => {
    assert.deepEqual(filter, { _id: parcelId, status: { $ne: 'Processing' } });
    return status === 'Processing' ? null : { _id: parcelId, customerId, status, ...changes };
  });
  const result = await request(`/api/parcel/assign/${parcelId}`, { id: adminId, method: 'PUT', body: { agentId } });
  assert.equal(result.status, 409);
  assert.equal(events.length, 0);
  status = 'Booked';
  const confirmed = await request(`/api/parcel/assign/${parcelId}`, { id: adminId, method: 'PUT', body: { agentId } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.agentId, agentId);
});

test('agents cannot advance a Processing request, even if an old assignment exists', async () => {
  const save = mock.fn(async () => {});
  mock.method(Parcel, 'findOne', async () => ({ _id: parcelId, customerId, agentId, status: 'Processing', save }));
  for (const status of ['Booked', 'Picked Up', 'Failed']) {
    assert.equal((await request(`/api/parcel/status/${parcelId}`, { id: agentId, method: 'PUT', body: { status } })).status, 400);
  }
  const lookup = mock.method(Parcel, 'find', () => ({ sort: async () => [] }));
  assert.equal((await request('/api/parcel/assigned', { id: agentId })).status, 200);
  assert.deepEqual(lookup.mock.calls[0].arguments[0], { agentId, status: { $ne: 'Processing' } });
  assert.equal(save.mock.callCount(), 0);
});

test('admin can manage an accepted parcel delivery without assigning an agent', async () => {
  const parcel = {
    _id: parcelId,
    customerId,
    status: 'Booked',
    save: async function () { return this; }
  };
  const lookup = mock.method(Parcel, 'findById', async (id) => {
    assert.equal(id, parcelId);
    return parcel;
  });

  const pickedUp = await request(`/api/parcel/status/${parcelId}`, {
    id: adminId,
    method: 'PUT',
    body: { status: 'Picked Up' }
  });
  assert.equal(pickedUp.status, 200);
  assert.equal(pickedUp.body.status, 'Picked Up');
  assert.equal(lookup.mock.callCount(), 1);

  const inTransit = await request(`/api/parcel/status/${parcelId}`, {
    id: adminId,
    method: 'PUT',
    body: { status: 'In Transit' }
  });
  assert.equal(inTransit.status, 200);

  const delivered = await request(`/api/parcel/status/${parcelId}`, {
    id: adminId,
    method: 'PUT',
    body: { status: 'Delivered' }
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.status, 'Delivered');
  assert.deepEqual(events.filter(({ event }) => event === 'statusUpdate').map(({ room, data }) => ({
    room,
    status: data.status
  })), [
    { room: `customer:${customerId}`, status: 'Picked Up' },
    { room: 'admins', status: 'Picked Up' },
    { room: `customer:${customerId}`, status: 'In Transit' },
    { room: 'admins', status: 'In Transit' },
    { room: `customer:${customerId}`, status: 'Delivered' },
    { room: 'admins', status: 'Delivered' }
  ]);
  assert.equal((await request(`/api/parcel/status/${parcelId}`, {
    id: adminId,
    method: 'PUT',
    body: { status: 'Picked Up' }
  })).status, 400);
});

test('dashboard counts Processing separately from confirmed daily bookings', async () => {
  mock.method(Parcel, 'countDocuments', async (filter) => {
    if (filter.status === 'Processing') return 3;
    if (filter.status === 'Failed') return 1;
    assert.deepEqual(filter.status, { $ne: 'Processing' });
    assert.ok(filter.$or[0].acceptedAt.$gte instanceof Date);
    return 0;
  });
  mock.method(Parcel, 'aggregate', async () => []);
  const result = await request('/api/admin/dashboard', { id: adminId });
  assert.equal(result.status, 200);
  assert.equal(result.body.processingParcels, 3);
  assert.equal(result.body.dailyBookings, 0);
});

test('public registration cannot choose admin or agent privileges', async () => {
  mock.method(User, 'findOne', async () => null);
  mock.method(User.prototype, 'save', async function () { return this; });
  for (const role of ['admin', 'agent']) {
    const result = await request('/api/auth/register', { method: 'POST', body: { name: 'New Customer', email: 'new@example.com', password: 'customer-password', role } });
    assert.equal(result.status, 201);
    assert.equal(result.body.user.role, 'customer');
    assert.equal(jwt.verify(result.body.token, process.env.JWT_SECRET).role, 'customer');
    assert.equal(result.body.user.password, undefined);
  }
});

test('admin role edits take effect for existing tokens and revoke existing sockets', async () => {
  const oldToken = token(customerId);
  const promote = await request(`/api/admin/users/${customerId}/role`, { id: adminId, method: 'PATCH', body: { role: 'admin' } });
  assert.equal(promote.status, 200);
  assert.equal(promote.body.user.role, 'admin');
  assert.equal(promote.body.user.password, undefined);
  assert.deepEqual(events, [{ room: `user:${customerId}`, event: 'roleChanged', data: { role: 'admin' } }, { room: `user:${customerId}`, disconnected: true }]);
  const promotedSession = await request('/api/auth/me', { bearer: oldToken });
  assert.equal(promotedSession.body.user.role, 'admin');
  const oldAdminToken = token(customerId);
  const demote = await request(`/api/admin/users/${customerId}/role`, { id: adminId, method: 'PATCH', body: { role: 'customer' } });
  assert.equal(demote.status, 200);
  assert.equal((await request('/api/admin/users', { bearer: oldAdminToken })).status, 403);
  assert.equal((await request('/api/auth/me', { bearer: oldAdminToken })).body.user.role, 'customer');
});

test('admin cannot change their own role, unknown users, or invalid/agent roles', async () => {
  for (const [id, role, expected] of [
    [adminId, 'customer', 400],
    [customerId, 'owner', 400],
    [customerId, 'agent', 400],
    [customerId, { role: 'admin' }, 400],
    [agentId, 'customer', 400],
    ['bad-id', 'admin', 400],
    ['507f1f77bcf86cd799439099', 'admin', 404]
  ]) {
    const result = await request(`/api/admin/users/${id}/role`, { id: adminId, method: 'PATCH', body: { role } });
    assert.equal(result.status, expected);
  }
  assert.equal(accounts.get(adminId).role, 'admin');
});

test('session endpoint returns only public account fields', async () => {
  const result = await request('/api/auth/me', { id: adminId });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.user).sort(), ['email', 'id', 'name', 'role']);
});

test('admin provisioning hashes passwords and never overwrites existing accounts', async () => {
  mock.method(User, 'findOne', async () => null);
  const create = mock.method(User, 'create', async (data) => ({ _id: adminId, ...data }));
  const result = await createAdmin({ name: ' Administrator ', email: ' ADMIN@Example.com ', password: 'long-private-password' });
  assert.equal(result.created, true);
  assert.equal(result.user.role, 'admin');
  assert.equal(result.user.email, 'admin@example.com');
  assert.equal(await bcrypt.compare('long-private-password', result.user.password), true);
  assert.equal(create.mock.callCount(), 1);
  mock.restoreAll();
  mock.method(User, 'findOne', async () => accounts.get(adminId));
  assert.equal((await createAdmin({ email: 'admin@example.com', password: 'another-long-password' })).created, false);
  mock.restoreAll();
  mock.method(User, 'findOne', async () => accounts.get(customerId));
  await assert.rejects(createAdmin({ email: 'customer@example.com', password: 'another-long-password' }), /non-admin account/);
  assert.equal(accounts.get(customerId).role, 'customer');
  await assert.rejects(createAdmin({ email: 'admin@example.com', password: 'short' }), /12 characters/);
});
