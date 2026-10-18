import React, { useEffect, useState } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';
import { api, connectSocket, GOOGLE_MAPS_API_KEY, responseError } from '../api';
import { DashboardLayout, EmptyState, Icon, ParcelRoute, StatCard, StatusBadge } from './UI';

const CustomerDashboard = () => {
  const [parcels, setParcels] = useState([]);
  const [form, setForm] = useState({ pickupAddress: '', deliveryAddress: '', parcelType: '', paymentType: 'COD' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    const socket = connectSocket();

    api.get('/api/parcel/my-parcels')
      .then((response) => {
        if (active) setParcels(response.data);
      })
      .catch((requestError) => {
        if (active) setError(responseError(requestError, 'Unable to load your parcels.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    socket.on('statusUpdate', (update) => {
      setParcels((previous) => previous.map((parcel) =>
        parcel._id === update._id ? { ...parcel, ...update } : parcel
      ));
    });
    socket.on('connect_error', () => {
      if (active) setError('Live updates are unavailable. Refresh to check parcel status.');
    });

    return () => {
      active = false;
      socket.disconnect();
    };
  }, []);

  const handleBook = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const response = await api.post('/api/parcel/book', form);
      setParcels((previous) => [response.data, ...previous]);
      setForm({ pickupAddress: '', deliveryAddress: '', parcelType: '', paymentType: 'COD' });
      setSuccess('Request submitted for admin acceptance. Booking confirmation will appear in My parcels.');
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to submit this booking request.'));
    } finally {
      setSubmitting(false);
    }
  };

  const locatedParcels = parcels.filter((parcel) => parcel.coordinates?.lat != null && parcel.coordinates?.lng != null);

  return (
    <DashboardLayout role="customer" title="Your deliveries, simplified." description="Request a booking or catch up on the parcels already on their way.">
      <div className="stats-grid">
        <StatCard label="Total parcels" value={loading ? '—' : parcels.length} detail="All your delivery requests" />
        <StatCard label="On the way" value={loading ? '—' : parcels.filter((parcel) => ['Picked Up', 'In Transit'].includes(parcel.status)).length} icon="truck" detail="Picked up & in transit" />
        <StatCard label="Delivered" value={loading ? '—' : parcels.filter((parcel) => parcel.status === 'Delivered').length} icon="check" detail="Successfully completed" />
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      {success && <p role="status" className="success-message"><Icon name="check" size={17} />{success}</p>}
      <div className="customer-grid">
      <section className="panel" id="book-parcel">
        <div className="panel-heading"><div><h2>Request a booking</h2><p>Submit your details for admin acceptance.</p></div><Icon name="plus" /></div>
        <form onSubmit={handleBook} className="booking-form">
          <label>Pickup address
            <input required placeholder="Where should we collect it?" value={form.pickupAddress} onChange={(event) => setForm({ ...form, pickupAddress: event.target.value })} />
          </label>
          <label>Delivery address
            <input required placeholder="Where is it headed?" value={form.deliveryAddress} onChange={(event) => setForm({ ...form, deliveryAddress: event.target.value })} />
          </label>
          <label>Parcel type
            <input required placeholder="e.g. Documents, clothing, electronics" value={form.parcelType} onChange={(event) => setForm({ ...form, parcelType: event.target.value })} />
          </label>
          <label>Payment method
            <select value={form.paymentType} onChange={(event) => setForm({ ...form, paymentType: event.target.value })}>
              <option value="COD">Cash on delivery</option>
              <option value="prepaid">Prepaid</option>
            </select>
          </label>
          <button type="submit" disabled={submitting} className="button-primary">
            {submitting ? 'Submitting...' : 'Submit request'}<Icon name="arrow" size={17} />
          </button>
          <p className="booking-note"><Icon name="clock" size={14} /> Booking is confirmed after admin acceptance.</p>
        </form>
      </section>

      <section className="panel" id="parcels">
        <div className="panel-heading"><div><h2>My parcels</h2><p>Every delivery, from start to finish.</p></div><span className="count-badge">{parcels.length}</span></div>
        {(loading || parcels.length === 0) && <EmptyState loading={loading} title="Your first delivery starts here" description="Submit a booking request using the form. It stays Processing until an admin accepts it." />}
        <div className="parcel-list">
          {parcels.map((parcel) => (
            <article key={parcel._id} className="parcel-card">
              <div className="parcel-card-heading"><span className="parcel-id" title={parcel._id}><Icon size={17} />#{parcel._id.slice(-8).toUpperCase()}</span><StatusBadge status={parcel.status} /></div>
              {parcel.status === 'Processing' && <p className="approval-note"><Icon name="clock" size={14} /> Awaiting admin acceptance.</p>}
              {parcel.status === 'Booked' && <p className="approval-note approval-confirmed"><Icon name="check" size={14} /> Booking confirmed.</p>}
              <ParcelRoute pickup={parcel.pickupAddress} delivery={parcel.deliveryAddress} />
              <div className="parcel-footer"><div className="parcel-details"><span>{parcel.parcelType} · {parcel.paymentType === 'COD' ? 'Cash on delivery' : 'Prepaid'}</span>{!GOOGLE_MAPS_API_KEY && parcel.coordinates && <span>Latest location: {parcel.coordinates.lat}, {parcel.coordinates.lng}</span>}</div>{parcel.qrCode && <img src={parcel.qrCode} alt={`Tracking QR code for parcel ${parcel._id}`} className="parcel-qr" />}</div>
            </article>
          ))}
        </div>
        {GOOGLE_MAPS_API_KEY && locatedParcels.length > 0 && (
          <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY}>
            <div className="map-list">
              {locatedParcels.map((parcel) => (
                <GoogleMap key={parcel._id} center={parcel.coordinates} zoom={14} mapContainerStyle={{ height: '220px', width: '100%' }}>
                  <Marker position={parcel.coordinates} />
                </GoogleMap>
              ))}
            </div>
          </LoadScript>
        )}
      </section>
      </div>
    </DashboardLayout>
  );
};

export default CustomerDashboard;
