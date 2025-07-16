const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const parcelRoutes = require('./routes/parcel');
const adminRoutes = require('./routes/admin');

dotenv.config();

const app = express(); // Initialize Express app
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: 'http://localhost:3000' } });

// Middleware to attach io to request object for Socket.IO usage
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

app.get('/', (req, res) => res.send('API running'));

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.on('disconnect', () => console.log('User disconnected'));
});

app.use('/api/auth', authRoutes);
app.use('/api/parcel', parcelRoutes); // Pass io via req.io middleware
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));