const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const http = require('http');
const { Server } = require('socket.io');
const authenticateToken = require('./utils/authenticateToken');
const { authenticateSession } = require('./middleware/auth');
const { COOKIE_NAME, readCookie } = require('./utils/sessions');
const { transactionSupport } = require('./domain/shared/transaction');
const Migration = require('./models/Migration');
const authRoutes = require('./routes/auth');
const parcelRoutes = require('./routes/parcel');
const adminRoutes = require('./routes/admin');
const merchantRoutes = require('./routes/merchants');
const operationsRoutes = require('./routes/operations');
const operationsBookingRoutes = require('./routes/operations-bookings');
const financeRoutes = require('./routes/finance');
const riderRoutes = require('./routes/rider');
const { createNotificationWorker } = require('./domain/notifications/outbox');

dotenv.config();

const migrationDirectory = path.join(__dirname, 'migrations');
const requiredMigrations = fs.readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.js$/.test(file))
  .sort()
  .map((file) => {
    const migrationPath = path.join(migrationDirectory, file);
    return {
      name: require(migrationPath).name,
      checksum: crypto.createHash('sha256').update(fs.readFileSync(migrationPath, 'utf8')).digest('hex')
    };
  });

const app = express(); // Initialize Express app
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const server = http.createServer(app);
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((url) => url.trim()).filter(Boolean);
const io = new Server(server, { cors: { origin: clientUrls, credentials: true } });

server.on('error', (err) => {
  console.error(`API server failed to listen: ${err.message}`);
  process.exitCode = 1;
});

io.use(async (socket, next) => {
  try {
    const sessionToken = readCookie(socket.handshake.headers.cookie, COOKIE_NAME);
    const bearer = socket.handshake.auth?.token;
    if (sessionToken) socket.data.user = await authenticateSession(sessionToken);
    else if (bearer && (process.env.NODE_ENV !== 'production' || process.env.LEGACY_BEARER_AUTH === 'true')) socket.data.user = await authenticateToken(bearer);
    else throw Object.assign(new Error('Authentication required'), { status: 401 });
    next();
  } catch (error) {
    next(new Error(error.message));
  }
});

// Middleware to attach io to request object for Socket.IO usage
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors({ origin: clientUrls, credentials: true }));
app.use('/api', (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' });
  next();
});
app.use((req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.cookie && (!req.headers.origin || !clientUrls.includes(req.headers.origin))) {
    return res.status(403).json({ msg: 'A configured request origin is required for session-authenticated writes' });
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/health/live', (req, res) => res.json({ status: 'alive' }));
app.get('/health/ready', async (req, res) => {
  const capability = transactionSupport();
  if (!capability.supported) return res.status(503).json({ status: 'not_ready', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected', reason: capability.reason });
  try {
    const applied = await Migration.find({ name: { $in: requiredMigrations.map((migration) => migration.name) } }).select('name checksum').lean();
    const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]));
    const missing = requiredMigrations.filter((migration) => !appliedByName.has(migration.name)).map((migration) => migration.name);
    const changed = requiredMigrations.filter((migration) => appliedByName.has(migration.name) && appliedByName.get(migration.name) !== migration.checksum).map((migration) => migration.name);
    const ready = missing.length === 0 && changed.length === 0;
    const reasons = [
      ...(missing.length ? [`Database migrations are pending: ${missing.join(', ')}`] : []),
      ...(changed.length ? [`Applied migrations do not match repository files: ${changed.join(', ')}`] : [])
    ];
    res.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      database: 'connected',
      reason: ready ? null : reasons.join('; ')
    });
  } catch (error) {
    res.status(503).json({ status: 'not_ready', database: 'connected', reason: 'Unable to verify database migrations' });
  }
});

io.on('connection', (socket) => {
  const { id, role } = socket.data.user;
  socket.join(`user:${id}`);
  if (role === 'customer') socket.join(`customer:${id}`);
  if (role === 'agent') socket.join(`agent:${id}`);
  if (role === 'merchant') socket.join(`merchant:${id}`);
  if (role === 'rider') socket.join(`rider:${id}`);
  if (role === 'admin') socket.join(['admins', 'finance', 'all-branches']);
  if (role === 'accounts') socket.join('finance');
  if (['operations', 'accounts'].includes(role)) {
    for (const branchId of socket.data.user.branchIds || []) socket.join(`branch:${branchId}`);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/parcel', parcelRoutes); // Pass io via req.io middleware
app.use('/api/admin', adminRoutes);
app.use('/api/merchants', merchantRoutes);
app.use('/api/operations/parcels', operationsRoutes);
app.use('/api/operations/bookings', operationsBookingRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/rider', riderRoutes);

const PORT = process.env.PORT || 5000;
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  throw new Error('MONGO_URI and JWT_SECRET must be configured before starting the API');
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    createNotificationWorker().start();
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exitCode = 1;
  });
