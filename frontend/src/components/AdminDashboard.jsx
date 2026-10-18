import React, { useCallback, useEffect, useState } from 'react';
import { api, connectSocket, responseError } from '../api';
import { DashboardLayout, EmptyState, Icon, ParcelRoute, StatCard, StatusBadge } from './UI';
import { useAuth } from '../auth-context';

const AdminDashboard = () => {
  const [metrics, setMetrics] = useState({ dailyBookings: 0, processingParcels: 0, failedDeliveries: 0, codAmounts: 0 });
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [changingUserId, setChangingUserId] = useState('');
  const [success, setSuccess] = useState('');
  const { user: currentUser } = useAuth();

  const fetchData = useCallback(async () => {
    try {
      const [metricsResponse, usersResponse, bookingsResponse] = await Promise.all([
        api.get('/api/admin/dashboard'),
        api.get('/api/admin/users'),
        api.get('/api/admin/bookings')
      ]);
      setMetrics(metricsResponse.data);
      setUsers(usersResponse.data);
      setBookings(bookingsResponse.data);
      setError('');
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to load admin dashboard.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const socket = connectSocket();
    socket.on('statusUpdate', fetchData);
    socket.on('parcelRequested', fetchData);
    socket.on('connect', fetchData);
    socket.on('connect_error', () => setError('Live updates are unavailable. Refresh to check booking status.'));
    return () => socket.disconnect();
  }, [fetchData]);

  const acceptBooking = async (parcelId) => {
    setError('');
    setSuccess('');
    setAcceptingId(parcelId);
    try {
      const response = await api.put(`/api/parcel/accept/${parcelId}`);
      setBookings((previous) => previous.map((booking) => booking._id === parcelId ? { ...booking, status: response.data.status, acceptedAt: response.data.acceptedAt, qrCode: response.data.qrCode } : booking));
      setSuccess('Booking accepted. You can now manage its delivery status here.');
      await fetchData();
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to accept this booking request.'));
    } finally {
      setAcceptingId('');
    }
  };

  const updateStatus = async (parcelId, status) => {
    setError('');
    setSuccess('');
    setUpdatingId(parcelId);
    try {
      const response = await api.put(`/api/parcel/status/${parcelId}`, { status });
      setBookings((previous) => previous.map((booking) =>
        booking._id === parcelId ? { ...booking, status: response.data.status, coordinates: response.data.coordinates } : booking
      ));
      setSuccess(`Parcel status updated to ${response.data.status}.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update this parcel status.'));
    } finally {
      setUpdatingId('');
    }
  };

  const changeRole = async (userId, role) => {
    setError('');
    setSuccess('');
    setChangingUserId(userId);
    try {
      const response = await api.patch(`/api/admin/users/${userId}/role`, { role });
      setUsers((previous) => previous.map((user) => user._id === userId ? { ...user, role: response.data.user.role } : user));
      setSuccess(`${response.data.user.name} now has the ${response.data.user.role} role.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update this user role.'));
    } finally {
      setChangingUserId('');
    }
  };

  return (
    <DashboardLayout role="admin" title="Everything, running together." description="Review bookings and manage every delivery directly from your workspace.">
      <div className="stats-grid stats-grid-four">
        <StatCard label="Processing" value={loading ? '—' : metrics.processingParcels} icon="clock" detail="Awaiting your acceptance" />
        <StatCard label="Daily bookings" value={loading ? '—' : metrics.dailyBookings} detail="Bookings confirmed today" />
        <StatCard label="Failed deliveries" value={loading ? '—' : metrics.failedDeliveries} icon="clock" detail="Deliveries needing attention" />
        <StatCard label="Delivered COD parcels" value={loading ? '—' : metrics.codAmounts} icon="check" detail="Cash-on-delivery completions" />
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      {success && <p role="status" className="success-message"><Icon name="check" size={17} />{success}</p>}
      <section className="panel" id="bookings">
        <div className="panel-heading"><div><h2>Booking requests & deliveries</h2><p>Accept customer requests, then update delivery progress here—no agent assignment needed.</p></div><span className="count-badge">{bookings.length}</span></div>
        {(loading || bookings.length === 0) && <EmptyState loading={loading} title="A clear start" description="New customer requests will appear here as Processing, ready for your acceptance." />}
        <div className="parcel-list agent-list">
          {[...bookings].sort((a, b) => Number(b.status === 'Processing') - Number(a.status === 'Processing')).map((booking) => (
            <article key={booking._id} className="parcel-card">
              <div className="parcel-card-heading"><span className="parcel-id" title={booking._id}><Icon size={17} />#{booking._id.slice(-8).toUpperCase()}</span><StatusBadge status={booking.status} /></div>
              <p className="booking-customer">Customer · <strong>{booking.customerId?.name || 'Unknown'}</strong></p>
              <ParcelRoute pickup={booking.pickupAddress} delivery={booking.deliveryAddress} />
              {booking.status === 'Processing'
                ? <div className="accept-booking"><p><Icon name="clock" size={14} /> Awaiting your acceptance</p><button type="button" className="button-primary" disabled={Boolean(acceptingId)} onClick={() => acceptBooking(booking._id)}><Icon name="check" size={16} />{acceptingId === booking._id ? 'Accepting...' : 'Accept booking'}</button></div>
                : <label className="assignment-field">{updatingId === booking._id ? 'Updating status...' : 'Update delivery status'}
                  <select
                    aria-label={`Update status for parcel ${booking._id}`}
                    value=""
                    disabled={Boolean(updatingId) || ['Delivered', 'Failed'].includes(booking.status)}
                    onChange={(event) => event.target.value && updateStatus(booking._id, event.target.value)}
                  >
                    <option value="">{['Delivered', 'Failed'].includes(booking.status) ? 'Delivery closed' : 'Choose next status'}</option>
                    {(booking.status === 'Booked'
                      ? ['Picked Up', 'Failed']
                      : booking.status === 'Picked Up'
                        ? ['In Transit', 'Failed']
                        : booking.status === 'In Transit'
                          ? ['Delivered', 'Failed']
                          : []
                    ).map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>}
            </article>
          ))}
        </div>
      </section>
      <section className="panel section-gap" id="users">
        <div className="panel-heading"><div><h2>People & permissions</h2><p>Admins manage deliveries and workspace access. Customers book and track their own parcels.</p></div><Icon name="users" /></div>
        {(loading || users.length === 0) ? <EmptyState loading={loading} title="No users to show" description="Registered accounts will appear here." /> : <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Name</th><th scope="col">Email address</th><th scope="col">Role</th></tr></thead><tbody>{users.map((user) => <tr key={user._id}>
          <td><span className="user-name"><span className="avatar">{user.name?.charAt(0).toUpperCase() || 'U'}</span>{user.name}{user._id === currentUser.id && <small className="self-label">You</small>}</span></td>
          <td>{user.email}</td>
          <td>{user.role === 'agent' ? <span className="user-role">Agent</span> : <select className="role-select" aria-label={`Role for ${user.name}`} value={user.role} disabled={Boolean(changingUserId) || user._id === currentUser.id} title={user._id === currentUser.id ? 'You cannot change your own role' : 'Change account permissions'} onChange={(event) => changeRole(user._id, event.target.value)}><option value="customer">Customer</option><option value="admin">Admin</option></select>}{changingUserId === user._id && <small className="role-saving" role="status">Saving...</small>}</td>
        </tr>)}</tbody></table></div>}
      </section>
    </DashboardLayout>
  );
};

export default AdminDashboard;
