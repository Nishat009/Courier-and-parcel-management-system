import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { GoogleMap, LoadScript, DirectionsRenderer } from '@react-google-maps/api';
import io from 'socket.io-client';

const socket = io('http://localhost:5000');

const AgentDashboard = () => {
  const [parcels, setParcels] = useState([]);
  const [directions, setDirections] = useState(null);
const fetchParcels = async () => {
      const res = await axios.get('http://localhost:5000/api/parcel/assigned', {
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

  const updateStatus = async (id, status) => {
    await axios.put(`http://localhost:5000/api/parcel/status/${id}`, { status, coordinates: { lat: 23.8103, lng: 90.4125 } }, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    fetchParcels();
  };

  const getRoute = async (parcel) => {
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: parcel.pickupAddress,
        destination: parcel.deliveryAddress,
        travelMode: 'DRIVING'
      },
      (result, status) => {
        if (status === 'OK') setDirections(result);
      }
    );
  };

  return (
    <div className="p-4">
      <h2 className="text-2xl font-bold mb-4">Agent Dashboard</h2>
      {parcels.map((parcel) => (
        <div key={parcel._id} className="border p-4 mb-2">
          <p>Status: {parcel.status}</p>
          <p>Pickup: {parcel.pickupAddress}</p>
          <p>Delivery: {parcel.deliveryAddress}</p>
          <select onChange={(e) => updateStatus(parcel._id, e.target.value)} className="p-2 border">
            <option value="">Update Status</option>
            <option value="Picked Up">Picked Up</option>
            <option value="In Transit">In Transit</option>
            <option value="Delivered">Delivered</option>
            <option value="Failed">Failed</option>
          </select>
          <button onClick={() => getRoute(parcel)} className="p-2 bg-blue-500 text-white">View Route</button>
          {directions && (
            
            <LoadScript >
              <GoogleMap mapContainerStyle={{ height: '200px', width: '100%' }}>
                <DirectionsRenderer directions={directions} />
              </GoogleMap>
            </LoadScript>
          )}
        </div>
      ))}
    </div>
  );
};

export default AgentDashboard;