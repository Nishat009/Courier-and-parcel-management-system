const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const authenticateToken = require('./utils/authenticateToken');
const authRoutes = require('./routes/auth');
const parcelRoutes = require('./routes/parcel');
const adminRoutes = require('./routes/admin');

dotenv.config();

const app = express(); // Initialize Express app
const server = http.createServer(app);
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((url) => url.trim()).filter(Boolean);
const io = new Server(server, { cors: { origin: clientUrls } });

server.on('error', (err) => {
  console.error(`API server failed to listen: ${err.message}`);
  process.exitCode = 1;
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  try {
    socket.data.user = await authenticateToken(token);
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

app.use(cors({ origin: clientUrls }));
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

io.on('connection', (socket) => {
  const { id, role } = socket.data.user;
  socket.join(`user:${id}`);
  if (role === 'customer') socket.join(`customer:${id}`);
  if (role === 'agent') socket.join(`agent:${id}`);
  if (role === 'admin') socket.join('admins');
});

app.use('/api/auth', authRoutes);
app.use('/api/parcel', parcelRoutes); // Pass io via req.io middleware
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  throw new Error('MONGO_URI and JWT_SECRET must be configured before starting the API');
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exitCode = 1;
  });
