import React, { useEffect, useState } from 'react';
import { DirectionsRenderer, GoogleMap, LoadScript } from '@react-google-maps/api';
import { api, connectSocket, GOOGLE_MAPS_API_KEY, responseError } from '../api';
import { DashboardLayout, EmptyState, Icon, ParcelRoute, StatCard, StatusBadge } from './UI';

const AgentDashboard = () => {
  const [parcels, setParcels] = useState([]);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [mapsLoaded, setMapsLoaded] = useState(false);
  const [mapsError, setMapsError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const socket = connectSocket();

    api.get('/api/parcel/assigned')
      .then((response) => {
        if (active) setParcels(response.data);
      })
      .catch((requestError) => {
        if (active) setError(responseError(requestError, 'Unable to load assigned parcels.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    socket.on('parcelAssigned', (parcel) => {
      setParcels((previous) => [parcel, ...previous.filter((item) => item._id !== parcel._id)]);
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

  const updateStatus = async (parcelId, status) => {
    setError('');
    setUpdatingId(parcelId);
    try {
      const response = await api.put(`/api/parcel/status/${parcelId}`, { status });
      setParcels((previous) => previous.map((parcel) =>
        parcel._id === parcelId ? response.data : parcel
      ));
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update parcel status.'));
    } finally {
      setUpdatingId('');
    }
  };

  const getRoute = (parcel) => {
    if (!GOOGLE_MAPS_API_KEY) {
      setError('Route directions are currently unavailable. Please use the pickup and delivery addresses.');
      return;
    }
    if (!mapsLoaded || !window.google?.maps) {
      setError('Google Maps is still loading. Please try again in a moment.');
      return;
    }
    new window.google.maps.DirectionsService().route({
      origin: parcel.pickupAddress,
      destination: parcel.deliveryAddress,
      travelMode: window.google.maps.TravelMode.DRIVING
    }, (result, status) => {
      if (status === 'OK') setRoute({ parcelId: parcel._id, directions: result });
      else setError(`Unable to load route (${status}).`);
    });
  };

  const dashboard = (
    <DashboardLayout role="agent" title="A smoother delivery day." description="Your assigned parcels, routes, and next steps in one place.">
      <div className="stats-grid">
        <StatCard label="Assigned parcels" value={loading ? '—' : parcels.length} detail="Your delivery workload" />
        <StatCard label="In progress" value={loading ? '—' : parcels.filter((parcel) => ['Booked', 'Picked Up', 'In Transit'].includes(parcel.status)).length} icon="truck" detail="Ready for the next step" />
        <StatCard label="Delivered" value={loading ? '—' : parcels.filter((parcel) => parcel.status === 'Delivered').length} icon="check" detail="Successfully completed" />
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      <section className="panel" id="parcels">
      <div className="panel-heading"><div><h2>Assigned parcels</h2><p>Keep each delivery moving forward.</p></div><Icon name="truck" /></div>
      {(loading || parcels.length === 0) && <EmptyState loading={loading} title="You're all caught up" description="New parcels will appear here when they are assigned to you." />}
      <div className="parcel-list agent-list">
        {parcels.map((parcel) => (
          <article key={parcel._id} className="parcel-card">
            <div className="parcel-card-heading"><span className="parcel-id" title={parcel._id}><Icon size={17} />#{parcel._id.slice(-8).toUpperCase()}</span><StatusBadge status={parcel.status} /></div>
            <ParcelRoute pickup={parcel.pickupAddress} delivery={parcel.deliveryAddress} />
            <div className="parcel-actions">
              <select
                aria-label={`Update status for parcel ${parcel._id}`}
                value=""
                disabled={Boolean(updatingId) || ['Delivered', 'Failed'].includes(parcel.status)}
                onChange={(event) => updateStatus(parcel._id, event.target.value)}
              >
                <option value="">{updatingId === parcel._id ? 'Updating...' : ['Delivered', 'Failed'].includes(parcel.status) ? 'Delivery closed' : 'Update status'}</option>
                {(parcel.status === 'Booked'
                  ? ['Picked Up', 'Failed']
                  : parcel.status === 'Picked Up'
                    ? ['In Transit', 'Failed']
                    : parcel.status === 'In Transit'
                      ? ['Delivered', 'Failed']
                      : []
                ).map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              {GOOGLE_MAPS_API_KEY && <button type="button" onClick={() => getRoute(parcel)} disabled={!mapsLoaded || mapsError} className="button-primary">
                <Icon name="pin" size={15} />{mapsError ? 'Route unavailable' : mapsLoaded ? 'View route' : 'Loading map...'}
              </button>}
            </div>
          </article>
        ))}
      </div>
      </section>
      {route && (
        <section className="panel section-gap" aria-label="Delivery route">
          <div className="panel-heading"><div><h2>Delivery route</h2><p>Parcel #{route.parcelId.slice(-8).toUpperCase()}</p></div><Icon name="pin" /></div>
          <GoogleMap mapContainerStyle={{ height: '320px', width: '100%' }} zoom={8}>
            <DirectionsRenderer directions={route.directions} />
          </GoogleMap>
        </section>
      )}
    </DashboardLayout>
  );

  return <>
    {GOOGLE_MAPS_API_KEY && <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} onLoad={() => setMapsLoaded(true)} onError={() => setMapsError(true)} loadingElement={<></>} />}
    {dashboard}
  </>;
};

export default AgentDashboard;
