import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

const CustomerDashboard = () => {
  const [parcels, setParcels] = useState([]);
  const [form, setForm] = useState({ pickupAddress: '', deliveryAddress: '', parcelType: '', paymentType: 'COD' });
 const fetchParcels = async () => {
      const res = await axios.get('http://localhost:5000/api/parcel/my-parcels', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setParcels(res.data);
    };
  useEffect(() => {
   
    fetchParcels();
    socket.on('statusUpdate', (updatedParcel) => {
      setParcels((prev) => prev.map((p) => (p._id === updatedParcel._id ? updatedParcel : p)));
    });
    return () => socket.off('statusUpdate');
  }, []);

  const handleBook = async (e) => {
    e.preventDefault();
    await axios.post('http://localhost:5000/api/parcel/book', form, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    setForm({ pickupAddress: '', deliveryAddress: '', parcelType: '', paymentType: 'COD' });
    fetchParcels();
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Customer Dashboard</h2>
      <div className="mb-4">
        <h3 className="text-xl">Book a Parcel</h3>
        <div className="space-y-4">
          <input type="text" value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} placeholder="Pickup Address" className="w-full p-2 border" />
          <input type="text" value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Delivery Address" className="w-full p-2 border" />
          <input type="text" value={form.parcelType} onChange={(e) => setForm({ ...form, parcelType: e.target.value })} placeholder="Parcel Type" className="w-full p-2 border" />
          <select value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })} className="w-full p-2 border">
            <option value="COD">COD</option>
            <option value="prepaid">Prepaid</option>
          </select>
          <button onClick={handleBook} className="w-full p-2 bg-blue-500 text-white">Book Parcel</button>
        </div>
      </div>
      <h3 className="text-xl">Your Parcels</h3>
      {parcels.map((parcel) => (
        <div key={parcel._id} className="border p-4 mb-2">
          <p>Status: {parcel.status}</p>
          <p>Pickup: {parcel.pickupAddress}</p>
          <p>Delivery: {parcel.deliveryAddress}</p>
          {parcel.coordinates && (
            <LoadScript >
              <GoogleMap center={parcel.coordinates} zoom={15} mapContainerStyle={{ height: '200px', width: '100%' }}>
                <Marker position={parcel.coordinates} />
              </GoogleMap>
            </LoadScript>
          )}
          {parcel.qrCode && <img src={parcel.qrCode} alt="QR Code" className="w-20 h-20" />}
        </div>
      ))}
    </div>
  );
};

export default CustomerDashboard;