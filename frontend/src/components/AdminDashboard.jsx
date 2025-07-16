import React, { useState, useEffect } from 'react';
import axios from 'axios';

const AdminDashboard = () => {
  const [metrics, setMetrics] = useState({});
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);
const fetchData = async () => {
      const [metricsRes, usersRes, bookingsRes] = await Promise.all([
        axios.get('http://localhost:5000/api/admin/dashboard', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
        axios.get('http://localhost:5000/api/admin/users', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }),
        axios.get('http://localhost:5000/api/admin/bookings', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      ]);
      setMetrics(metricsRes.data);
      setUsers(usersRes.data);
      setBookings(bookingsRes.data);
    };
  useEffect(() => {
    
    fetchData();
  }, []);

  const assignAgent = async (parcelId, agentId) => {
    await axios.put(`http://localhost:5000/api/parcel/assign/${parcelId}`, { agentId }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    fetchData();
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Admin Dashboard</h2>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="p-4 border">Daily Bookings: {metrics.dailyBookings}</div>
        <div className="p-4 border">Failed Deliveries: {metrics.failedDeliveries}</div>
        <div className="p-4 border">COD Amounts: {metrics.codAmounts}</div>
      </div>
      <h3 className="text-xl">Users</h3>
      {users.map((user) => (
        <div key={user._id} className="border p-2 mb-2">{user.name} - {user.email} ({user.role})</div>
      ))}
      <h3 className="text-xl">Bookings</h3>
      {bookings.map((booking) => (
        <div key={booking._id} className="border p-2 mb-2">
          <p>Customer: {booking.customerId.name}</p>
          <p>Status: {booking.status}</p>
          <select onChange={(e) => assignAgent(booking._id, e.target.value)} className="p-2 border">
            <option value="">Assign Agent</option>
            {users.filter((u) => u.role === 'agent').map((agent) => (
              <option key={agent._id} value={agent._id}>{agent.name}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
};

export default AdminDashboard;