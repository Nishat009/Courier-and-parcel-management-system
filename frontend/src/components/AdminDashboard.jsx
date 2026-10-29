import React, { useCallback, useEffect, useState } from 'react';
import { api, API_URL, connectSocket, responseError, runIdempotent } from '../api';
import { decimalToInteger, formatBdt, integerToDecimalString } from '../money';
import { DashboardLayout, EmptyState, Icon, ParcelRoute, StatCard, StatusBadge } from './UI';
import { useAuth } from '../auth-context';


const AdminDashboard = () => {
  const [metrics, setMetrics] = useState({ dailyBookings: 0, processingParcels: 0, failedDeliveries: 0, codAmounts: 0 });
  const [users, setUsers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [applications, setApplications] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [emailProviderConfigured, setEmailProviderConfigured] = useState(null);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationPages, setNotificationPages] = useState(1);
  const [notificationStatus, setNotificationStatus] = useState('dead_letter');
  const [retryingNotification, setRetryingNotification] = useState('');
  const [applicationNotes, setApplicationNotes] = useState({});
  const [applicationPage, setApplicationPage] = useState(1);
  const [applicationPages, setApplicationPages] = useState(1);
  const [applicationStatus, setApplicationStatus] = useState('pending');
  const [userPage, setUserPage] = useState(1); const [userPages, setUserPages] = useState(1); const [userTotal, setUserTotal] = useState(0); const [userRoleFilter, setUserRoleFilter] = useState(''); const [userSearchInput, setUserSearchInput] = useState(''); const [userSearch, setUserSearch] = useState('');
  const [staffForm, setStaffForm] = useState({ name: '', email: '', password: '', role: 'operations', branchIds: [] });
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [bookingPage, setBookingPage] = useState(1); const [bookingPages, setBookingPages] = useState(1); const [bookingTotal, setBookingTotal] = useState(0); const [bookingStatus, setBookingStatus] = useState('');
  const [branches, setBranches] = useState([]);
  const [branchForm, setBranchForm] = useState({ code: '', name: '', city: '', address: '' });
  const [editingBranchId, setEditingBranchId] = useState('');
  const [branchEditForm, setBranchEditForm] = useState({ name: '', city: '', address: '', phone: '' });
  const [pricing, setPricing] = useState({ sameBranchFee: '', interBranchFee: '', codFeePercent: '' });
  const [pricingHistory, setPricingHistory] = useState([]);
  const [savingPricing, setSavingPricing] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [changingUserId, setChangingUserId] = useState('');
  const [changingBranchId, setChangingBranchId] = useState('');
  const [success, setSuccess] = useState('');
  const { user: currentUser } = useAuth();

  const fetchData = useCallback(async () => {
    try {
      const applicationQuery = new URLSearchParams({ page: String(applicationPage), limit: '20', status: applicationStatus });
      const userQuery = new URLSearchParams({ page: String(userPage), limit: '25' }); if (userRoleFilter) userQuery.set('role', userRoleFilter); if (userSearch) userQuery.set('q', userSearch);
      const bookingQuery = new URLSearchParams({ page: String(bookingPage), limit: '25' }); if (bookingStatus) bookingQuery.set('status', bookingStatus);
      const notificationQuery = new URLSearchParams({ page: String(notificationPage), limit: '10' }); if (notificationStatus) notificationQuery.set('status', notificationStatus);
      const [metricsResponse, usersResponse, bookingsResponse, applicationsResponse, branchesResponse, pricingResponse, notificationResponse] = await Promise.all([
        api.get('/api/admin/dashboard'),
        api.get(`/api/admin/users?${userQuery}`),
        api.get(`/api/admin/bookings?legacy=true&${bookingQuery}`),
        api.get(`/api/merchants/applications?${applicationQuery}`),
        api.get('/api/admin/branches'),
        api.get('/api/admin/pricing'),
        api.get(`/api/admin/notifications?${notificationQuery}`)
      ]);
      setMetrics(metricsResponse.data);
      setUsers(usersResponse.data.items);
      setUserPages(usersResponse.data.pages || 1); setUserTotal(usersResponse.data.total || 0);
      if (userPage > (usersResponse.data.pages || 1)) setUserPage(usersResponse.data.pages || 1);
      setBookings(bookingsResponse.data.items);
      setBookingPages(bookingsResponse.data.pages || 1); setBookingTotal(bookingsResponse.data.total || 0);
      if (bookingPage > (bookingsResponse.data.pages || 1)) setBookingPage(bookingsResponse.data.pages || 1);
      setApplications(applicationsResponse.data.items);
      setApplicationPages(applicationsResponse.data.pages || 1);
      if (applicationPage > (applicationsResponse.data.pages || 1)) setApplicationPage(applicationsResponse.data.pages || 1);
      setNotifications(notificationResponse.data.items);
      setEmailProviderConfigured(Boolean(notificationResponse.data.providerConfigured));
      setNotificationPages(notificationResponse.data.pages || 1);
      if (notificationPage > (notificationResponse.data.pages || 1)) setNotificationPage(notificationResponse.data.pages || 1);
      setBranches(branchesResponse.data.items);
      setPricing({
        sameBranchFee: integerToDecimalString(pricingResponse.data.sameBranchFeePoisha) || '0.00',
        interBranchFee: integerToDecimalString(pricingResponse.data.interBranchFeePoisha) || '0.00',
        codFeePercent: integerToDecimalString(pricingResponse.data.codFeeBasisPoints) || '0.00'
      });
      setPricingHistory(pricingResponse.data.history || []);
      setError('');
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to load admin dashboard.'));
    } finally {
      setLoading(false);
    }
  }, [applicationPage, applicationStatus, bookingPage, bookingStatus, notificationPage, notificationStatus, userPage, userRoleFilter, userSearch]);

  useEffect(() => {
    fetchData();
    const socket = connectSocket();
    socket.on('statusUpdate', fetchData);
    socket.on('parcelRequested', fetchData);
    socket.on('connect', fetchData);
    socket.on('connect_error', () => setError('Live updates are unavailable. Refresh to check booking status.'));
    return () => socket.disconnect();
  }, [fetchData]);

  const changeRole = async (userId, role) => {
    setError('');
    setSuccess('');
    setChangingUserId(userId);
    try {
      const target = users.find((user) => user._id === userId);
      const branchIds = ['operations', 'accounts', 'rider'].includes(role) ? (target?.branchIds || []).map((branch) => typeof branch === 'string' ? branch : branch._id) : [];
      const response = await api.patch(`/api/admin/users/${userId}/access`, { role, branchIds });
      setUsers((previous) => previous.map((user) => user._id === userId ? { ...user, role: response.data.user.role } : user));
      setSuccess(`${response.data.user.name} now has the ${response.data.user.role} role.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update this user role.'));
    } finally {
      setChangingUserId('');
    }
  };

  const changeUserStatus = async (target) => {
    const accountStatus = target.accountStatus === 'active' ? 'suspended' : 'active';
    setError('');
    setSuccess('');
    setChangingUserId(target._id);
    try {
      const response = await api.patch(`/api/admin/users/${target._id}/status`, { accountStatus });
      setUsers((previous) => previous.map((user) => user._id === target._id ? { ...user, accountStatus: response.data.user.accountStatus } : user));
      setSuccess(`${target.name}'s staff access is now ${response.data.user.accountStatus}.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to change staff account status.'));
    } finally {
      setChangingUserId('');
    }
  };

  const createStaff = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    setCreatingStaff(true);
    try {
      const response = await api.post('/api/admin/users', staffForm);
      setStaffForm({ name: '', email: '', password: '', role: 'operations', branchIds: [] });
      setUserRoleFilter(response.data.user.role);
      setUserSearchInput(''); setUserSearch('');
      setUserPage(1);
      setSuccess(`Staff account created for ${response.data.user.name}. Share the initial password through a secure channel.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to create staff account.'));
    } finally {
      setCreatingStaff(false);
    }
  };

  const assignBranches = async (userId, event) => {
    setError('');
    setChangingUserId(userId);
    try {
      const target = users.find((user) => user._id === userId);
      const branchIds = [...event.target.selectedOptions].map((option) => option.value);
      await api.patch(`/api/admin/users/${userId}/access`, { role: target.role, branchIds });
      setUsers((previous) => previous.map((user) => user._id === userId ? { ...user, branchIds: branches.filter((branch) => branchIds.includes(branch._id)) } : user));
      setSuccess('Branch access updated.');
    } catch (requestError) { setError(responseError(requestError, 'Unable to update branch access.')); }
    finally { setChangingUserId(''); }
  };

  const createBranch = async (event) => {
    event.preventDefault(); setError(''); setSuccess('');
    try { const response = await api.post('/api/admin/branches', branchForm); setBranches((previous) => [...previous, response.data]); setBranchForm({ code: '', name: '', city: '', address: '' }); setSuccess('Branch created.'); }
    catch (requestError) { setError(responseError(requestError, 'Unable to create branch.')); }
  };

  const toggleBranch = async (branch) => {
    const active = !branch.active;
    setError('');
    setSuccess('');
    setChangingBranchId(branch._id);
    try {
      const response = await runIdempotent(`branch-active:${branch._id}:${active}`, (key) => api.patch(`/api/admin/branches/${branch._id}`, { active }, { headers: { 'Idempotency-Key': key } }));
      setBranches((previous) => previous.map((item) => item._id === branch._id ? response.data : item));
      setSuccess(`${branch.name} ${active ? 'activated' : 'deactivated'}.`);
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update branch status.'));
    } finally {
      setChangingBranchId('');
    }
  };

  const editBranch = (branch) => {
    setEditingBranchId(branch._id);
    setBranchEditForm({ name: branch.name, city: branch.city, address: branch.address, phone: branch.phone || '' });
  };

  const saveBranch = async (event, branch) => {
    event.preventDefault(); setError(''); setSuccess(''); setChangingBranchId(branch._id);
    try {
      const response = await api.patch(`/api/admin/branches/${branch._id}`, branchEditForm);
      setBranches((previous) => previous.map((item) => item._id === branch._id ? response.data : item));
      setEditingBranchId(''); setSuccess(`${response.data.name} branch details updated.`);
    } catch (requestError) { setError(responseError(requestError, 'Unable to update branch details.')); }
    finally { setChangingBranchId(''); }
  };

  const savePricing = async (event) => {
    event.preventDefault();
    setError('');
    setSuccess('');
    const sameBranchFeePoisha = decimalToInteger(pricing.sameBranchFee);
    const interBranchFeePoisha = decimalToInteger(pricing.interBranchFee);
    const codFeeBasisPoints = decimalToInteger(pricing.codFeePercent);
    if ([sameBranchFeePoisha, interBranchFeePoisha, codFeeBasisPoints].some((value) => value === null)) {
      setError('Enter fees and COD percentage with no more than two decimal places.');
      return;
    }
    setSavingPricing(true);
    try {
      const response = await api.put('/api/admin/pricing', {
        sameBranchFeePoisha,
        interBranchFeePoisha,
        codFeeBasisPoints
      });
      setPricing({
        sameBranchFee: integerToDecimalString(response.data.sameBranchFeePoisha) || '0.00',
        interBranchFee: integerToDecimalString(response.data.interBranchFeePoisha) || '0.00',
        codFeePercent: integerToDecimalString(response.data.codFeeBasisPoints) || '0.00'
      });
      await fetchData();
      setSuccess('Booking prices updated. Existing parcel price snapshots are unchanged.');
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to update booking prices.'));
    } finally {
      setSavingPricing(false);
    }
  };

  const reviewApplication = async (applicationId, decision) => {
    setError('');
    setSuccess('');
    try {
      const note = applicationNotes[applicationId] || '';
      const body = { decision, note };
      const response = await runIdempotent(`merchant-review:${applicationId}:${JSON.stringify(body)}`, (key) => api.patch(`/api/merchants/applications/${applicationId}/review`, body, { headers: { 'Idempotency-Key': key } }));
      setSuccess(`${response.data.application.businessName} ${decision === 'approved' && applicationStatus === 'suspended' ? 'reinstated' : decision}.`);
      setApplicationNotes((previous) => ({ ...previous, [applicationId]: '' }));
      await fetchData();
    } catch (requestError) {
      setError(responseError(requestError, 'Unable to review merchant application.'));
    }
  };

  const retryNotification = async (notification) => {
    setError(''); setSuccess(''); setRetryingNotification(notification._id);
    try {
      await api.post(`/api/admin/notifications/${notification._id}/retry`);
      setSuccess('Notification queued for another delivery attempt.');
      await fetchData();
    } catch (requestError) { setError(responseError(requestError, 'Unable to retry this notification.')); }
    finally { setRetryingNotification(''); }
  };

  return (
    <DashboardLayout role="admin" title="Everything, running together." description="Review merchant applications, manage branch access, pricing, and courier operations.">
      <div className="stats-grid stats-grid-four">
        <StatCard label="Processing" value={loading ? '—' : metrics.processingParcels} icon="clock" detail="Awaiting your acceptance" />
        <StatCard label="Daily bookings" value={loading ? '—' : metrics.dailyBookings} detail="Bookings confirmed today" />
        <StatCard label="Failed deliveries" value={loading ? '—' : metrics.failedDeliveries} icon="clock" detail="Deliveries needing attention" />
        <StatCard label="Delivered COD parcels" value={loading ? '—' : metrics.codAmounts} icon="check" detail="Cash-on-delivery completions" />
      </div>
      {error && <p role="alert" className="alert">{error}</p>}
      {success && <p role="status" className="success-message"><Icon name="check" size={17} />{success}</p>}
      <section className="panel" id="merchant-applications">
        <div className="panel-heading"><div><h2>Merchant applications</h2><p>Approval enables a merchant account to book parcels.</p></div><div className="parcel-actions"><label>Application status<select aria-label="Filter merchant application status" value={applicationStatus} onChange={(event) => { setApplicationStatus(event.target.value); setApplicationPage(1); }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="suspended">Suspended</option></select></label><span className="count-badge">{applications.length}</span></div></div>
        {loading && <EmptyState loading title="Loading merchant applications" description="" />}
        {!loading && !error && applications.length === 0 && <EmptyState title="No applications waiting" description="New merchant applications will appear here." />}
        <div className="parcel-list">{applications.map((application) => <article className="parcel-card" key={application._id}>
          <div className="parcel-card-heading"><strong>{application.businessName}</strong><StatusBadge status={application.status} /></div>
          <p>{application.contactName} · {application.userId?.email} · {application.phone}</p><p>{application.pickupAddress}</p>
          {application.status === 'pending' && <div className="parcel-actions"><button className="button-primary" onClick={() => reviewApplication(application._id, 'approved')}>Approve merchant</button><button className="button-secondary" onClick={() => reviewApplication(application._id, 'rejected')}>Reject application</button></div>}
          {application.status === 'approved' && <div className="parcel-actions"><label>Suspension reason (required)<input minLength="8" value={applicationNotes[application._id] || ''} onChange={(event) => setApplicationNotes({ ...applicationNotes, [application._id]: event.target.value })} /></label><button className="button-secondary" disabled={(applicationNotes[application._id] || '').trim().length < 8} onClick={() => reviewApplication(application._id, 'suspended')}>Suspend merchant</button></div>}
          {application.status === 'suspended' && <div className="parcel-actions"><small>Reason: {application.reviewNote || 'Not recorded'}</small><button className="button-primary" onClick={() => reviewApplication(application._id, 'approved')}>Reinstate merchant</button></div>}
        </article>)}</div>
        <div className="parcel-actions"><button className="button-secondary" disabled={applicationPage <= 1 || loading} onClick={() => setApplicationPage((value) => Math.max(1, value - 1))}>Previous applications</button><span>Page {applicationPage} of {applicationPages}</span><button className="button-secondary" disabled={applicationPage >= applicationPages || loading} onClick={() => setApplicationPage((value) => Math.min(applicationPages, value + 1))}>Next applications</button></div>
        <div className="parcel-actions section-gap"><a className="button-secondary" href="/operations">Operations workspace</a><a className="button-secondary" href="/accounts">Accounts workspace</a></div>
      </section>
      <section className="panel section-gap" id="notifications">
        <div className="panel-heading"><div><h2>Email notification queue</h2><p>SMTP acceptance is recorded here; it does not confirm delivery to a recipient.</p></div><div className="parcel-actions"><label>Filter email status<select aria-label="Filter email notifications" value={notificationStatus} onChange={(event) => { setNotificationStatus(event.target.value); setNotificationPage(1); }}><option value="dead_letter">Needs retry</option><option value="pending">Pending</option><option value="sending">Sending</option><option value="accepted">Accepted by SMTP</option><option value="">All statuses</option></select></label><button className="button-secondary" onClick={fetchData}>Refresh</button></div></div>
        {emailProviderConfigured === false && <p className="field-hint" role="status">SMTP is not configured. Queued emails will remain pending until an email provider is configured.</p>}
        {loading && <EmptyState loading title="Loading notification queue" description="" />}{!loading && !error && notifications.length === 0 && <EmptyState title="No matching emails" description="Merchant application emails will appear here when queued." />}
        <div className="parcel-list">{notifications.map((notification) => <article className="parcel-card" key={notification._id}><div className="parcel-card-heading"><strong>{notification.template.replaceAll('_', ' ')}</strong><StatusBadge status={notification.status} /></div><p>Recipient: {notification.recipient}</p><p>Attempts: {notification.attempts} · Manual retries: {notification.manualRetries || 0}{notification.providerStatus && <> · Provider: {notification.providerStatus}</>}{notification.lastErrorCode && <> · Last error: {notification.lastErrorCode}</>}</p><small>Updated {new Date(notification.updatedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}{notification.lastManuallyRetriedBy?.name && ` · Retried by ${notification.lastManuallyRetriedBy.name}`}</small>{notification.status === 'dead_letter' && <div className="parcel-actions"><button className="button-primary" disabled={Boolean(retryingNotification)} onClick={() => retryNotification(notification)}>{retryingNotification === notification._id ? 'Queueing…' : 'Retry email'}</button></div>}</article>)}</div>
        <div className="parcel-actions"><button className="button-secondary" disabled={notificationPage <= 1 || loading} onClick={() => setNotificationPage((value) => Math.max(1, value - 1))}>Previous emails</button><span>Page {notificationPage} of {notificationPages}</span><button className="button-secondary" disabled={notificationPage >= notificationPages || loading} onClick={() => setNotificationPage((value) => Math.min(notificationPages, value + 1))}>Next emails</button></div>
      </section>
      <section className="panel" id="bookings">
        <div className="panel-heading"><div><h2>Legacy customer parcels</h2><p>Historical records are retained as read-only references. {bookingTotal} total. Current merchant bookings are managed from Operations.</p></div><div className="parcel-actions"><label>Filter status<select aria-label="Filter legacy parcels by status" value={bookingStatus} onChange={(event) => { setBookingStatus(event.target.value); setBookingPage(1); }}><option value="">All statuses</option>{['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled', 'Failed'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label><span className="count-badge">{bookings.length}</span></div></div>
        {(loading || (!error && bookings.length === 0)) && <EmptyState loading={loading} title="No legacy parcels" description="Existing customer parcel records appear here as read-only history." />}
        <div className="parcel-list agent-list">
          {[...bookings].sort((a, b) => Number(b.status === 'Processing') - Number(a.status === 'Processing')).map((booking) => (
            <article key={booking._id} className="parcel-card">
              <div className="parcel-card-heading"><span className="parcel-id" title={booking._id}><Icon size={17} />#{booking._id.slice(-8).toUpperCase()}</span><StatusBadge status={booking.status} /></div>
              <p className="booking-customer">Customer · <strong>{booking.customerId?.name || 'Unknown'}</strong></p>
              <ParcelRoute pickup={booking.pickupAddress} delivery={booking.deliveryAddress} />
              {booking.recipientName && <p>Recipient: <strong>{booking.recipientName}</strong>{booking.recipientPhone && <> · <a href={`tel:${booking.recipientPhone}`}>{booking.recipientPhone}</a></>}</p>}
              {booking.proofs?.length > 0 && <div className="parcel-actions"><strong>Delivery proof:</strong>{booking.proofs.map((proof) => <a className="button-secondary" key={proof._id} href={`${API_URL}/api/rider/proofs/${proof._id}`} target="_blank" rel="noreferrer">Download photo</a>)}</div>}

            </article>
          ))}
        </div>
        <div className="parcel-actions"><button className="button-secondary" disabled={bookingPage <= 1 || loading} onClick={() => setBookingPage((value) => Math.max(1, value - 1))}>Previous bookings</button><span>Page {bookingPage} of {bookingPages}</span><button className="button-secondary" disabled={bookingPage >= bookingPages || loading} onClick={() => setBookingPage((value) => Math.min(bookingPages, value + 1))}>Next bookings</button></div>
      </section>
      <section className="panel section-gap" id="users">
        <div className="panel-heading"><div><h2>People & permissions</h2><p>Create staff accounts and assign their branch scope. Merchant access is managed through application review. {userTotal} matching accounts.</p></div><div className="parcel-actions"><form className="inline-search" role="search" onSubmit={(event) => { event.preventDefault(); setUserSearch(userSearchInput.trim().slice(0, 100)); setUserPage(1); }}><label className="sr-only" htmlFor="admin-user-search">Search user name or email</label><input id="admin-user-search" maxLength="100" placeholder="Name or email prefix" value={userSearchInput} onChange={(event) => setUserSearchInput(event.target.value)} /><button className="button-secondary">Search</button></form><label>Filter role<select aria-label="Filter users by role" value={userRoleFilter} onChange={(event) => { setUserRoleFilter(event.target.value); setUserPage(1); }}><option value="">All roles</option>{['admin', 'operations', 'accounts', 'merchant', 'rider', 'agent', 'customer'].map((role) => <option key={role} value={role}>{role}</option>)}</select></label><Icon name="users" /></div></div>
        <form className="booking-form" onSubmit={createStaff}>
          <label>Staff name<input required maxLength={120} autoComplete="name" value={staffForm.name} onChange={(event) => setStaffForm({ ...staffForm, name: event.target.value })} /></label>
          <label>Staff email<input required type="email" autoComplete="email" value={staffForm.email} onChange={(event) => setStaffForm({ ...staffForm, email: event.target.value })} /></label>
          <label>Initial password<input required type="password" minLength={12} maxLength={72} autoComplete="new-password" value={staffForm.password} onChange={(event) => setStaffForm({ ...staffForm, password: event.target.value })} /></label>
          <label>Workspace role<select value={staffForm.role} onChange={(event) => setStaffForm({ ...staffForm, role: event.target.value, branchIds: event.target.value === 'admin' ? [] : staffForm.branchIds })}><option value="operations">Operations</option><option value="accounts">Accounts</option><option value="rider">Rider</option><option value="admin">Admin</option></select></label>
          {staffForm.role !== 'admin' && <label>Branch access<select required multiple size={Math.min(5, Math.max(2, branches.filter((branch) => branch.active).length))} className="role-select branch-select" value={staffForm.branchIds} onChange={(event) => setStaffForm({ ...staffForm, branchIds: [...event.target.selectedOptions].map((option) => option.value) })}>{branches.filter((branch) => branch.active).map((branch) => <option key={branch._id} value={branch._id}>{branch.name} · {branch.city}</option>)}</select><small>{branches.some((branch) => branch.active) ? 'Select all branches this staff member can access.' : 'Create an active branch before adding branch-scoped staff.'}</small></label>}
          <button type="submit" className="button-primary" disabled={creatingStaff || loading}>{creatingStaff ? 'Creating account…' : 'Create staff account'}</button>
        </form>
        {loading ? <EmptyState loading title="Loading users" description="" /> : users.length === 0 ? (!error && <EmptyState title="No users to show" description="Registered accounts will appear here." />) : <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Name</th><th scope="col">Email address</th><th scope="col">Role</th></tr></thead><tbody>{users.map((user) => <tr key={user._id}>
          <td><span className="user-name"><span className="avatar">{user.name?.charAt(0).toUpperCase() || 'U'}</span>{user.name}{user._id === currentUser.id && <small className="self-label">You</small>}</span></td>
          <td>{user.email}</td>
          <td>{['agent', 'merchant', 'customer'].includes(user.role) ? <span className="user-role">{user.role}{user.accountStatus === 'pending' ? ' · pending' : ''}</span> : <><select className="role-select" aria-label={`Role for ${user.name}`} value={user.role} disabled={Boolean(changingUserId) || user._id === currentUser.id} title={user._id === currentUser.id ? 'You cannot change your own role' : 'Change account permissions'} onChange={(event) => changeRole(user._id, event.target.value)}><option value="admin">Admin</option><option value="operations">Operations</option><option value="accounts">Accounts</option><option value="rider">Rider</option></select>{['operations', 'accounts', 'rider'].includes(user.role) && <><select multiple className="role-select branch-select" aria-label={`Branches for ${user.name}`} value={(user.branchIds || []).map((branch) => typeof branch === 'string' ? branch : branch._id)} disabled={Boolean(changingUserId) || user._id === currentUser.id} onChange={(event) => assignBranches(user._id, event)}>{branches.filter((branch) => branch.active).map((branch) => <option key={branch._id} value={branch._id}>{branch.name}</option>)}</select><div className="parcel-actions"><StatusBadge status={user.accountStatus} /><button className="button-secondary" aria-label={`${user.accountStatus === 'active' ? 'Suspend' : 'Reactivate'} ${user.name} staff access`} disabled={Boolean(changingUserId) || user._id === currentUser.id} onClick={() => changeUserStatus(user)}>{user.accountStatus === 'active' ? 'Suspend access' : 'Reactivate access'}</button></div></>}</>}{changingUserId === user._id && <small className="role-saving" role="status">Saving...</small>}</td>
        </tr>)}</tbody></table></div>}
        <div className="parcel-actions"><button className="button-secondary" disabled={userPage <= 1 || loading} onClick={() => setUserPage((value) => Math.max(1, value - 1))}>Previous users</button><span>Page {userPage} of {userPages}</span><button className="button-secondary" disabled={userPage >= userPages || loading} onClick={() => setUserPage((value) => Math.min(userPages, value + 1))}>Next users</button></div>
      </section>
      <section className="panel section-gap" id="pricing"><div className="panel-heading"><div><h2>Booking prices</h2><p>These rates apply to new bookings. Existing parcels keep the price snapshot created at booking.</p></div></div>
        <form className="booking-form" onSubmit={savePricing}>
          <label>Same-branch delivery fee (BDT)<input required type="number" min="0" step="0.01" value={pricing.sameBranchFee} onChange={(event) => setPricing({ ...pricing, sameBranchFee: event.target.value })} /></label>
          <label>Inter-branch delivery fee (BDT)<input required type="number" min="0" step="0.01" value={pricing.interBranchFee} onChange={(event) => setPricing({ ...pricing, interBranchFee: event.target.value })} /></label>
          <label>COD fee rate (%)<input required type="number" min="0" max="100" step="0.01" value={pricing.codFeePercent} onChange={(event) => setPricing({ ...pricing, codFeePercent: event.target.value })} /></label>
          <button className="button-primary" disabled={savingPricing || loading}>{savingPricing ? 'Saving prices…' : 'Save prices'}</button>
        </form>
        {pricingHistory.length > 0 && <div className="parcel-list section-gap"><h3>Recent price changes</h3>{pricingHistory.slice(-5).reverse().map((entry, index) => <article className="parcel-card" key={index}><strong>{entry.changedBy?.name || 'Admin'} · {new Date(entry.changedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</strong><span>Same branch {formatBdt(entry.sameBranchFeePoisha)} · Inter branch {formatBdt(entry.interBranchFeePoisha)} · COD {integerToDecimalString(entry.codFeeBasisPoints)}%</span></article>)}</div>}
      </section>
      <section className="panel section-gap" id="branches"><div className="panel-heading"><div><h2>Branches & hubs</h2><p>Use branches to scope operations, riders, bookings, and cash handovers.</p></div></div>
        <div className="parcel-list">{branches.map((branch) => <article className="parcel-card" key={branch._id}>
          <div className="parcel-card-heading"><strong>{branch.name}</strong><StatusBadge status={branch.active ? 'active' : 'inactive'} /></div>
          {editingBranchId === branch._id ? <form className="booking-form" onSubmit={(event) => saveBranch(event, branch)}>
            <label>Branch name<input required maxLength={160} value={branchEditForm.name} onChange={(event) => setBranchEditForm({ ...branchEditForm, name: event.target.value })} /></label>
            <label>City<input required maxLength={160} value={branchEditForm.city} onChange={(event) => setBranchEditForm({ ...branchEditForm, city: event.target.value })} /></label>
            <label>Address<input required maxLength={500} value={branchEditForm.address} onChange={(event) => setBranchEditForm({ ...branchEditForm, address: event.target.value })} /></label>
            <label>Phone (optional)<input type="tel" maxLength={32} value={branchEditForm.phone} onChange={(event) => setBranchEditForm({ ...branchEditForm, phone: event.target.value })} /></label>
            <div className="parcel-actions"><button className="button-primary" disabled={Boolean(changingBranchId)}>{changingBranchId === branch._id ? 'Saving…' : 'Save branch details'}</button><button type="button" className="button-secondary" disabled={Boolean(changingBranchId)} onClick={() => setEditingBranchId('')}>Cancel</button></div>
          </form> : <><p>{branch.code} · {branch.city} · {branch.address}{branch.phone && <> · {branch.phone}</>}</p><div className="parcel-actions"><button className="button-secondary" disabled={Boolean(changingBranchId)} onClick={() => editBranch(branch)}>Edit details</button><button className={branch.active ? 'button-secondary' : 'button-primary'} disabled={Boolean(changingBranchId)} onClick={() => toggleBranch(branch)}>{changingBranchId === branch._id ? 'Saving…' : branch.active ? 'Deactivate branch' : 'Activate branch'}</button></div></>}
        </article>)}</div>
        <form className="booking-form" onSubmit={createBranch}><label>Branch code<input required value={branchForm.code} onChange={(e) => setBranchForm({ ...branchForm, code: e.target.value })} /></label><label>Branch name<input required value={branchForm.name} onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })} /></label><label>City<input required value={branchForm.city} onChange={(e) => setBranchForm({ ...branchForm, city: e.target.value })} /></label><label>Address<input required value={branchForm.address} onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })} /></label><button className="button-primary">Add branch</button></form>
      </section>
    </DashboardLayout>
  );
};

export default AdminDashboard;
