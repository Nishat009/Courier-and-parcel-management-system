import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_URL, connectSocket, responseError, runIdempotent } from '../api';
import { decimalToInteger, formatBdt as bdt } from '../money';
import { AuthLayout, DashboardLayout, EmptyState, ParcelRoute, StatusBadge } from './UI';
import { useAuth } from '../auth-context';

const idOf = (value) => String(value?._id || value || '');

export function MerchantApplication() {
  const [form, setForm] = useState({ name: '', email: '', password: '', businessName: '', phone: '', pickupAddress: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    try { const result = await api.post('/api/merchants/apply', form); setMessage(`Application submitted for ${result.data.merchant.businessName}. Sign in after an admin approves it.`); }
    catch (requestError) { setError(responseError(requestError, 'Unable to submit the application.')); }
    finally { setSaving(false); }
  };
  return <AuthLayout>
    <h2>Apply for a merchant account</h2><p className="auth-description">Tell us about your Bangladesh business. Operations will review the application before booking is enabled.</p>
    {message && <p role="status" className="success-message">{message}</p>}{error && <p role="alert" className="alert">{error}</p>}
    <form onSubmit={submit} className="auth-form">
      {[['name', 'Contact name', 'text'], ['businessName', 'Business name', 'text'], ['email', 'Email address', 'email'], ['phone', 'Mobile number', 'tel'], ['pickupAddress', 'Pickup address', 'text'], ['password', 'Password (12+ characters)', 'password']].map(([key, label, type]) => <label key={key}>{label}<input required type={type} minLength={key === 'password' ? 12 : undefined} autoComplete={key === 'password' ? 'new-password' : undefined} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
      <button className="button-primary" disabled={saving}>{saving ? 'Submitting…' : 'Submit application'}</button>
    </form><p className="auth-switch"><Link to="/login">Back to sign in</Link></p>
  </AuthLayout>;
}

export function MerchantPortal() {
  const [branches, setBranches] = useState([]); const [parcels, setParcels] = useState([]); const [payouts, setPayouts] = useState([]); const [ledgerBalance, setLedgerBalance] = useState(0); const [eligibility, setEligibility] = useState({ parcelCount: 0, amountPoisha: 0 });
  const [form, setForm] = useState({ pickupAddress: '', deliveryAddress: '', recipientName: '', recipientPhone: '', parcelType: '', originBranchId: '', destinationBranchId: '', paymentType: 'COD', codAmount: '' });
  const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [payoutPage, setPayoutPage] = useState(1); const [payoutPages, setPayoutPages] = useState(1); const [statusFilter, setStatusFilter] = useState(''); const [payoutStatusFilter, setPayoutStatusFilter] = useState(''); const [trackingSearch, setTrackingSearch] = useState(''); const [parcelSearchInput, setParcelSearchInput] = useState('');
  const [parcelEvents, setParcelEvents] = useState({}); const [eventLoading, setEventLoading] = useState({}); const [eventErrors, setEventErrors] = useState({});
  const [bookingQuote, setBookingQuote] = useState(null); const [quoteLoading, setQuoteLoading] = useState(false); const [quoteError, setQuoteError] = useState('');
  const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { const query = new URLSearchParams({ page: String(page), limit: '20' }); if (statusFilter) query.set('status', statusFilter); if (trackingSearch) query.set('q', trackingSearch); const payoutQuery = new URLSearchParams({ page: String(payoutPage), limit: '10' }); if (payoutStatusFilter) payoutQuery.set('status', payoutStatusFilter); const [b, p, pay, ledger, eligible] = await Promise.all([api.get('/api/merchants/branches'), api.get(`/api/merchants/parcels?${query}`), api.get(`/api/merchants/payouts?${payoutQuery}`), api.get('/api/merchants/ledger'), api.get('/api/merchants/payout-eligibility')]); setBranches(b.data.items); setParcels(p.data.items); setPages(p.data.pages || 1); setPayouts(pay.data.items); setPayoutPages(pay.data.pages || 1); setLedgerBalance(ledger.data.balancePoisha); setEligibility(eligible.data); }
    catch (requestError) { setError(responseError(requestError, 'Unable to load merchant workspace.')); }
    finally { setLoading(false); }
  }, [page, payoutPage, statusFilter, payoutStatusFilter, trackingSearch]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const socket = connectSocket();
    socket.on('statusUpdate', refresh);
    socket.on('payoutChanged', refresh);
    return () => socket.disconnect();
  }, [refresh]);
  useEffect(() => { if (branches.length && !form.originBranchId) setForm((previous) => ({ ...previous, originBranchId: branches[0]._id, destinationBranchId: branches[0]._id })); }, [branches, form.originBranchId]);
  useEffect(() => {
    if (!form.originBranchId || !form.destinationBranchId) return undefined;
    const controller = new AbortController();
    const codAmountPoisha = form.paymentType === 'COD'
      ? (form.codAmount === '' ? 0 : decimalToInteger(form.codAmount))
      : 0;
    setBookingQuote(null); setQuoteError('');
    if (codAmountPoisha === null) { setQuoteError('Use at most two decimal places for the COD amount.'); setQuoteLoading(false); return () => controller.abort(); }
    setQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.post('/api/merchants/booking-quote', { originBranchId: form.originBranchId, destinationBranchId: form.destinationBranchId, codAmountPoisha }, { signal: controller.signal });
        setBookingQuote(response.data.priceSnapshot);
      } catch (requestError) {
        if (!controller.signal.aborted) setQuoteError(responseError(requestError, 'Unable to calculate a booking estimate.'));
      } finally { if (!controller.signal.aborted) setQuoteLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [form.originBranchId, form.destinationBranchId, form.paymentType, form.codAmount]);
  const submitBooking = async (event) => {
    event.preventDefault(); setError(''); setNotice('');
    const codAmountPoisha = form.paymentType === 'COD' ? decimalToInteger(form.codAmount) : 0;
    if (codAmountPoisha === null) { setError('Enter a COD amount with no more than two decimal places.'); return; }
    setSaving(true);
    try {
      const bookingBody = { ...form, codAmountPoisha };
      const result = await runIdempotent(`merchant-booking:${JSON.stringify(bookingBody)}`, (key) => api.post('/api/merchants/bookings', bookingBody, { headers: { 'Idempotency-Key': key } }));
      setNotice(`Booking request received. Tracking code: ${result.data.trackingCode}`);
      setForm((previous) => ({ ...previous, pickupAddress: '', deliveryAddress: '', recipientName: '', recipientPhone: '', parcelType: '', codAmount: '' })); await refresh();
    } catch (requestError) { setError(responseError(requestError, 'Unable to create booking.')); }
    finally { setSaving(false); }
  };
  const requestPayout = async () => {
    setSaving(true); setError(''); setNotice('');
    try { const body = { allEligible: true }; const result = await runIdempotent(`merchant-payout:${JSON.stringify(body)}`, (key) => api.post('/api/merchants/payouts', body, { headers: { 'Idempotency-Key': key } })); setNotice(`Payout request created for ${bdt(result.data.amountPoisha)}.`); await refresh(); }
    catch (requestError) { setError(responseError(requestError, 'Unable to request payout.')); }
    finally { setSaving(false); }
  };
  const loadParcelEvents = async (parcelId) => {
    setEventLoading((current) => ({ ...current, [parcelId]: true })); setEventErrors((current) => ({ ...current, [parcelId]: '' }));
    try { const result = await api.get(`/api/merchants/parcels/${parcelId}/events`); setParcelEvents((current) => ({ ...current, [parcelId]: result.data.events || [] })); }
    catch (requestError) { setEventErrors((current) => ({ ...current, [parcelId]: responseError(requestError, 'Unable to load scan history.') })); }
    finally { setEventLoading((current) => ({ ...current, [parcelId]: false })); }
  };
  return <DashboardLayout role="merchant" title="Your parcels and payouts." description="Book with your branches, follow each scan, and request COD settlement after cash is reconciled.">
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <div className="customer-grid">
      <section className="panel" id="bookings"><div className="panel-heading"><div><h2>New booking</h2><p>Rates are snapshotted when a request is submitted.</p></div></div>
        {branches.length === 0 && !loading && !error ? <EmptyState title="No branches configured" description="Ask operations to add active pickup and destination branches." /> : <form className="booking-form" onSubmit={submitBooking}>
          <label>Pickup branch<select required value={form.originBranchId} onChange={(e) => setForm({ ...form, originBranchId: e.target.value })}>{branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} · {branch.city}</option>)}</select></label>
          <label>Pickup address<input required value={form.pickupAddress} onChange={(e) => setForm({ ...form, pickupAddress: e.target.value })} placeholder="Area, road, building" /></label>
          <label>Destination branch<select required value={form.destinationBranchId} onChange={(e) => setForm({ ...form, destinationBranchId: e.target.value })}>{branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} · {branch.city}</option>)}</select></label>
          <label>Delivery address<input required value={form.deliveryAddress} onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Area, road, building" /></label>
          <label>Recipient name<input required maxLength="120" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} /></label>
          <label>Recipient mobile<input required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" pattern="(?:\\+?8801|01)[3-9][0-9]{8}" title="Enter a Bangladesh mobile number, e.g. 017XXXXXXXX" value={form.recipientPhone} onChange={(e) => setForm({ ...form, recipientPhone: e.target.value })} /></label>
          <label>Parcel contents<input required value={form.parcelType} onChange={(e) => setForm({ ...form, parcelType: e.target.value })} placeholder="Documents, clothing…" /></label>
          <label>Payment<select value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })}><option value="COD">Cash on delivery</option><option value="prepaid">Prepaid</option></select></label>
          {form.paymentType === 'COD' && <label>COD amount (BDT)<input required type="number" min="0" step="0.01" value={form.codAmount} onChange={(e) => setForm({ ...form, codAmount: e.target.value })} /></label>}
          <div className="price-estimate" aria-live="polite"><strong>Booking estimate</strong>{quoteLoading && <p role="status">Calculating current rates…</p>}{quoteError && <p role="alert" className="field-hint">{quoteError}</p>}{bookingQuote && <dl><dt>Delivery fee</dt><dd>{bdt(bookingQuote.deliveryFeePoisha)}</dd>{form.paymentType === 'COD' && <><dt>COD fee</dt><dd>{bdt(bookingQuote.codFeePoisha)} ({bookingQuote.codFeeBasisPoints / 100}%)</dd><dt>Recipient pays on delivery</dt><dd>{bdt(bookingQuote.codAmountPoisha)}</dd><dt>Estimated merchant settlement</dt><dd>{bdt(bookingQuote.merchantNetPoisha)}</dd></>}</dl>}<small>Final charges are recalculated and saved in the booking price snapshot.</small></div>
          <button className="button-primary" disabled={saving || !branches.length}>{saving ? 'Submitting…' : 'Request booking'}</button>
        </form>}
      </section>
      <section className="panel" id="payouts"><div className="panel-heading"><div><h2>Settlement</h2><p>Only reconciled COD collections can be requested.</p></div><div className="parcel-actions"><label>Filter payout status<select aria-label="Filter payout status" value={payoutStatusFilter} onChange={(event) => { setPayoutStatusFilter(event.target.value); setPayoutPage(1); }}><option value="">All statuses</option>{['requested', 'approved', 'paid', 'reversed', 'rejected'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label><span className="count-badge">{eligibility.parcelCount}</span></div></div>
        <p>Ledger balance: <strong>{bdt(ledgerBalance)}</strong></p><p>{eligibility.parcelCount ? `${eligibility.parcelCount} parcel(s) eligible · ${bdt(eligibility.amountPoisha)}` : 'No reconciled COD balance is ready.'}</p>
        <button className="button-primary" disabled={saving || !eligibility.parcelCount} onClick={requestPayout}>Request eligible payout</button>
        <div className="parcel-list">{payouts.map((payout) => <article className="parcel-card" key={payout._id}><strong>{bdt(payout.amountPoisha)}</strong><StatusBadge status={payout.status} /><small>Requested {new Date(payout.requestedAt || payout.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</small>{payout.reviewedAt && <small>Reviewed {new Date(payout.reviewedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</small>}{payout.status === 'rejected' && payout.reviewNote && <small>Rejection reason: {payout.reviewNote}</small>}{payout.parcelIds?.length > 0 && <details><summary>Included parcels ({payout.parcelIds.length})</summary><ul className="event-list">{payout.parcelIds.map((parcel) => parcel && <li key={parcel._id}><strong>{parcel.trackingCode}</strong><small>Merchant net snapshot {bdt(parcel.priceSnapshot?.merchantNetPoisha || 0)} · COD status {parcel.cod?.status || 'not applicable'}</small></li>)}</ul></details>}{payout.paymentReference && <small>Payment reference: {payout.paymentReference}</small>}{payout.paidAt && <small>Payment recorded {new Date(payout.paidAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</small>}{payout.reversalReference && <small>Return reference: {payout.reversalReference}</small>}{payout.reversalNote && <small>Reversal reason: {payout.reversalNote}</small>}{payout.reversedAt && <small>Reversed {new Date(payout.reversedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</small>}</article>)}</div>{!loading && !error && payouts.length === 0 && <EmptyState title="No payout requests" description="Your submitted payout batches will appear here." />}<div className="parcel-actions"><button className="button-secondary" disabled={payoutPage <= 1 || loading} onClick={() => setPayoutPage((value) => Math.max(1, value - 1))}>Previous payouts</button><span>Payout page {payoutPage} of {payoutPages}</span><button className="button-secondary" disabled={payoutPage >= payoutPages || loading} onClick={() => setPayoutPage((value) => Math.min(payoutPages, value + 1))}>Next payouts</button></div>
      </section>
    </div>
    <section className="panel section-gap"><div className="panel-heading"><div><h2>Parcel history</h2><p>Booking snapshot, operational status and COD settlement stage.</p></div><div className="parcel-actions"><form className="inline-search" role="search" onSubmit={(event) => { event.preventDefault(); setTrackingSearch(parcelSearchInput.trim().slice(0, 40)); setPage(1); }}><label className="sr-only" htmlFor="merchant-tracking-search">Search tracking code</label><input id="merchant-tracking-search" maxLength="40" placeholder="Tracking code prefix" value={parcelSearchInput} onChange={(event) => setParcelSearchInput(event.target.value)} /><button className="button-secondary">Search</button></form>{trackingSearch && <button className="button-secondary" onClick={() => { setTrackingSearch(''); setParcelSearchInput(''); setPage(1); }}>Clear search</button>}<select aria-label="Filter parcel status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}><option value="">All statuses</option>{['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="button-secondary" onClick={refresh}>Refresh</button></div></div>
      {loading && <EmptyState loading title="Loading parcels" description="" />}{!loading && !error && parcels.length === 0 && <EmptyState title={trackingSearch || statusFilter ? 'No matching parcels' : 'No parcels yet'} description={trackingSearch || statusFilter ? 'Try a different tracking prefix or status filter.' : 'Create a booking request to begin.'} />}
      <div className="parcel-list">{parcels.map((parcel) => <article className="parcel-card" key={parcel._id}>
        <div className="parcel-card-heading"><strong>{parcel.trackingCode}</strong><StatusBadge status={parcel.status} /></div><ParcelRoute pickup={parcel.pickupAddress} delivery={parcel.deliveryAddress} />
        <div className="parcel-details"><span>Delivery fee snapshot: {bdt(parcel.priceSnapshot?.deliveryFeePoisha || 0)}</span>{parcel.paymentType === 'COD' && <><span>Recipient COD: {bdt(parcel.priceSnapshot?.codAmountPoisha || 0)}</span><span>COD fee snapshot: {bdt(parcel.priceSnapshot?.codFeePoisha || 0)} ({(parcel.priceSnapshot?.codFeeBasisPoints || 0) / 100}%)</span><span>Merchant net after reconciliation: {bdt(parcel.priceSnapshot?.merchantNetPoisha || 0)}</span></>}<span>COD stage: {parcel.cod?.status || 'not_due'}</span></div>
        {parcel.proofs?.length > 0 && <div className="parcel-actions"><strong>Delivery proof:</strong>{parcel.proofs.map((proof) => <a className="button-secondary" key={proof._id} href={`${API_URL}/api/rider/proofs/${proof._id}`} target="_blank" rel="noreferrer">Download photo</a>)}</div>}
        <button className="button-secondary" aria-expanded={Object.hasOwn(parcelEvents, parcel._id)} onClick={() => loadParcelEvents(parcel._id)} disabled={eventLoading[parcel._id]}>{eventLoading[parcel._id] ? 'Loading scan history…' : Object.hasOwn(parcelEvents, parcel._id) ? 'Refresh scan history' : 'View scan history'}</button>
        {eventErrors[parcel._id] && <p role="alert" className="alert">{eventErrors[parcel._id]}</p>}
        {Object.hasOwn(parcelEvents, parcel._id) && <ol className="event-list">{parcelEvents[parcel._id].map((event, index) => <li key={`${event.createdAt}-${index}`}><strong>{event.toStatus || event.type.replaceAll('_', ' ')}</strong>{event.type === 'cash_handover_disputed' && <small>{event.note || 'Physical cash did not match the handover total; accounts review is required.'}</small>}<time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</time></li>)}</ol>}
      </article>)}</div><div className="parcel-actions"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {pages}</span><button className="button-secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div>
    </section>
  </DashboardLayout>;
}

export function RiderPortal() {
  const [parcels, setParcels] = useState([]); const [branches, setBranches] = useState([]); const [handovers, setHandovers] = useState([]); const [selected, setSelected] = useState([]);
  const [declared, setDeclared] = useState(''); const [collections, setCollections] = useState({}); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [failureNotes, setFailureNotes] = useState({});
  const [proofFiles, setProofFiles] = useState({});
  const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [handoverPage, setHandoverPage] = useState(1); const [handoverPages, setHandoverPages] = useState(1); const [statusFilter, setStatusFilter] = useState(''); const [handoverStatusFilter, setHandoverStatusFilter] = useState('');
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { const query = new URLSearchParams({ page: String(page), limit: '30' }); if (statusFilter) query.set('status', statusFilter); const handoverQuery = new URLSearchParams({ page: String(handoverPage), limit: '10' }); if (handoverStatusFilter) handoverQuery.set('status', handoverStatusFilter); const [p, u, h] = await Promise.all([api.get(`/api/rider/parcels?${query}`), api.get('/api/auth/me'), api.get(`/api/finance/cash-handovers/mine?${handoverQuery}`)]); setParcels(p.data.items); setPages(p.data.pages || 1); setBranches(u.data.user.branchIds || []); setHandovers(h.data.items); setHandoverPages(h.data.pages || 1); } catch (e) { setError(responseError(e, 'Unable to load rider work.')); } finally { setLoading(false); } }, [page, statusFilter, handoverPage, handoverStatusFilter]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const socket = connectSocket();
    socket.on('parcelAssigned', refresh);
    socket.on('cashHandoverChanged', refresh);
    return () => socket.disconnect();
  }, [refresh]);
  const eligibleCash = parcels.filter((p) => p.status === 'Delivered' && p.cod?.status === 'collected');
  const selectedCash = eligibleCash.filter((parcel) => selected.includes(parcel._id));
  useEffect(() => {
    const eligibleIds = new Set(parcels.filter((parcel) => parcel.status === 'Delivered' && parcel.cod?.status === 'collected').map((parcel) => parcel._id));
    const retained = selected.filter((id) => eligibleIds.has(id));
    if (retained.length !== selected.length) { setSelected(retained); setDeclared(''); }
  }, [parcels, selected]);
  const selectedExpectedPoisha = selectedCash.reduce((sum, parcel) => sum + (parcel.cod?.collectedAmountPoisha || 0), 0);
  const transitionChoices = (status) => ({ Booked: ['Picked Up'], 'Picked Up': ['At Origin Hub'], 'At Destination Hub': ['Out for Delivery'], 'Out for Delivery': ['Delivery Failed'] }[status] || []);
  const advance = async (parcel, status, note = '') => {
    if (status === 'Delivery Failed' && note.trim().length < 8) { setError('Describe the delivery failure in at least 8 characters.'); return; }
    const amount = status === 'Delivered' && parcel.paymentType === 'COD' ? decimalToInteger(collections[parcel._id]) : 0;
    if (amount === null) { setError('Enter the cash amount using at most two decimal places.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      if (status === 'Delivered') {
        const body = { collectedAmountPoisha: amount };
        await runIdempotent(`delivery:${parcel._id}:${amount}`, (key) => api.post(`/api/finance/deliveries/${parcel._id}/confirm`, body, { headers: { 'Idempotency-Key': key } }));
        setNotice(parcel.paymentType === 'COD' ? 'Delivery and rider-recorded cash collection saved.' : 'Delivery saved.');
      } else await runIdempotent(`transition:${parcel._id}:${status}:${note.trim()}`, (key) => api.put(`/api/operations/parcels/${parcel._id}/transition`, { status, note }, { headers: { 'Idempotency-Key': key } }));
      if (status === 'Delivery Failed') setFailureNotes((previous) => ({ ...previous, [parcel._id]: '' }));
      await refresh();
    } catch (e) { setError(responseError(e, 'Unable to update parcel.')); }
    finally { setSaving(false); }
  };
  const handover = async () => {
    const amount = decimalToInteger(declared);
    if (amount === null) { setError('Enter the declared cash amount using at most two decimal places.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const body = { branchId: idOf(selectedCash[0]?.destinationBranchId), parcelIds: selectedCash.map((parcel) => parcel._id), declaredAmountPoisha: amount };
      await runIdempotent(`cash-handover:${JSON.stringify({ ...body, parcelIds: [...body.parcelIds].sort() })}`, (key) => api.post('/api/finance/cash-handovers', body, { headers: { 'Idempotency-Key': key } }));
      setSelected([]); setDeclared(''); setNotice('Cash handover submitted for accounts verification.'); await refresh();
    } catch (e) { setError(responseError(e, 'Unable to submit handover.')); }
    finally { setSaving(false); }
  };
  const uploadProof = async (parcel) => {
    const file = proofFiles[parcel._id];
    if (!file) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await api.post(`/api/rider/parcels/${parcel._id}/proofs`, await file.arrayBuffer(), { headers: { 'Content-Type': file.type } });
      setProofFiles((previous) => ({ ...previous, [parcel._id]: null }));
      setNotice('Private delivery photo saved. Only the assigned team and this merchant can view it.');
      await refresh();
    } catch (e) { setError(responseError(e, 'Unable to save delivery photo.')); }
    finally { setSaving(false); }
  };
  return <DashboardLayout role="rider" title="Your route, ready to move." description="Use the next-step controls at pickup and hubs. Record cash only when received, then hand it in for verification.">
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <section className="panel" id="parcels"><div className="panel-heading"><div><h2>Assigned parcels</h2><p>Only parcels assigned to your account and branch access are shown.</p></div><div className="parcel-actions"><select aria-label="Filter rider parcels by status" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="">All assigned work</option>{['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivery Failed', 'Delivered'].map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="button-secondary" onClick={refresh}>Refresh</button></div></div>
      {loading && <EmptyState loading title="Loading route" description="" />}{!loading && !error && !parcels.length && <EmptyState title="No assigned work" description="Operations will assign parcels to your branch." />}
      <div className="parcel-list">{parcels.map((parcel) => <article className="parcel-card" key={parcel._id}>
        <div className="parcel-card-heading"><strong>{parcel.trackingCode || `#${parcel._id.slice(-8).toUpperCase()}`}</strong><StatusBadge status={parcel.status} /></div><ParcelRoute pickup={parcel.pickupAddress} delivery={parcel.deliveryAddress} />
        <p>COD due: {bdt(parcel.priceSnapshot?.codAmountPoisha || 0)} · Cash stage: {parcel.cod?.status || 'not_due'}</p>
        {parcel.recipientName && <p>Recipient: <strong>{parcel.recipientName}</strong>{parcel.recipientPhone && <> · <a href={`tel:${parcel.recipientPhone}`}>{parcel.recipientPhone}</a></>}</p>}
        {parcel.proofs?.length > 0 && <div className="parcel-actions"><strong>Private proof:</strong>{parcel.proofs.map((proof) => <a className="button-secondary" key={proof._id} href={`${API_URL}/api/rider/proofs/${proof._id}`} target="_blank" rel="noreferrer">Download photo</a>)}</div>}
        {parcel.status === 'Delivered' && <div className="parcel-actions"><label>Delivery photo (JPEG, PNG or WebP; max 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={(event) => setProofFiles({ ...proofFiles, [parcel._id]: event.target.files?.[0] || null })} /></label><button className="button-secondary" disabled={saving || !proofFiles[parcel._id]} onClick={() => uploadProof(parcel)}>{saving ? 'Saving…' : 'Upload private proof'}</button></div>}
        <div className="parcel-actions">{transitionChoices(parcel.status).map((status) => status === 'Delivery Failed' ? <React.Fragment key={status}><label>Why was delivery unsuccessful?<textarea required minLength={8} maxLength={1000} value={failureNotes[parcel._id] || ''} onChange={(event) => setFailureNotes({ ...failureNotes, [parcel._id]: event.target.value })} /></label><button className="button-secondary" disabled={saving || (failureNotes[parcel._id] || '').trim().length < 8} onClick={() => advance(parcel, status, failureNotes[parcel._id] || '')}>Record failed attempt</button></React.Fragment> : <button className="button-secondary" key={status} disabled={saving} onClick={() => advance(parcel, status)}>{status}</button>)}{parcel.status === 'Out for Delivery' && <>{parcel.paymentType === 'COD' && <label>Cash actually received (BDT; due {bdt(parcel.priceSnapshot?.codAmountPoisha || 0)})<input required type="number" min="0" step="0.01" value={collections[parcel._id] || ''} onChange={(event) => setCollections({ ...collections, [parcel._id]: event.target.value })} /></label>}<button className="button-primary" disabled={saving || (parcel.paymentType === 'COD' && !collections[parcel._id])} onClick={() => advance(parcel, 'Delivered')}>Confirm delivered{parcel.paymentType === 'COD' ? ' & cash received' : ''}</button></>}</div>
      </article>)}</div><div className="parcel-actions"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {pages}</span><button className="button-secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div>
    </section>
    {eligibleCash.length > 0 && <section className="panel section-gap" id="cash-handover"><h2>Cash handover</h2><p>Accounts must verify the amount before the COD is eligible for payout.</p>{eligibleCash.map((parcel) => <label className="cash-item" key={parcel._id}><input type="checkbox" checked={selected.includes(parcel._id)} disabled={selected.some((id) => id !== parcel._id && idOf(eligibleCash.find((item) => item._id === id)?.destinationBranchId) !== idOf(parcel.destinationBranchId))} onChange={(e) => setSelected(e.target.checked ? [...selected, parcel._id] : selected.filter((id) => id !== parcel._id))} />{parcel.trackingCode} · {bdt(parcel.cod.collectedAmountPoisha)} · {parcel.destinationBranchId?.name || idOf(parcel.destinationBranchId)}</label>)}<p>{selectedCash.length} selected · expected cash {bdt(selectedExpectedPoisha)}. Enter the physical count below.</p><label>Declared handover amount (BDT)<input required type="number" min="0" step="0.01" value={declared} onChange={(e) => setDeclared(e.target.value)} /></label><button className="button-primary" disabled={saving || !selectedCash.length || branches.length === 0 || !declared} onClick={handover}>Submit cash handover</button></section>}
    <section className="panel section-gap" id="handover-history"><div className="panel-heading"><div><h2>My cash handovers</h2><p>Review account verification and recount history for your submitted cash batches.</p></div><div className="parcel-actions"><select aria-label="Filter cash handovers by status" value={handoverStatusFilter} onChange={(event) => { setHandoverStatusFilter(event.target.value); setHandoverPage(1); }}><option value="">All handovers</option><option value="submitted">Awaiting verification</option><option value="reconciled">Reconciled</option><option value="disputed">Disputed</option></select><button className="button-secondary" onClick={refresh} disabled={loading}>Refresh history</button></div></div>
      {loading && <EmptyState loading title="Loading handovers" description="" />}{!loading && !error && handovers.length === 0 && <EmptyState title="No cash handovers yet" description="Submitted cash batches will appear here with their verification status." />}
      <div className="parcel-list">{handovers.map((handover) => <article className="parcel-card" key={handover._id}>
        <div className="parcel-card-heading"><strong>{handover.branchId?.name || 'Branch'}{handover.branchId?.city ? ` · ${handover.branchId.city}` : ''}</strong><StatusBadge status={handover.status} /></div>
        <time dateTime={handover.submittedAt}>Submitted {new Date(handover.submittedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</time>
        <div className="parcel-details"><span>Expected: {bdt(handover.expectedAmountPoisha)}</span><span>Your count: {bdt(handover.declaredAmountPoisha)}</span>{handover.verifiedAmountPoisha != null && <span>Accounts count: {bdt(handover.verifiedAmountPoisha)}</span>}{handover.verifiedAt && <span>Reviewed: {new Date(handover.verifiedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</span>}</div>
        {handover.status === 'disputed' && <p role="status">The cash count differs from the expected total. Accounts must reconcile it before the COD can be paid out.</p>}
        {handover.reviewAttempts?.length > 0 && <details><summary>Accounts review history ({handover.reviewAttempts.length})</summary><ol className="event-list">{handover.reviewAttempts.map((review) => <li key={review._id}><strong>Attempt {review.attemptNumber}: {review.outcome}</strong><small>Expected {bdt(review.expectedAmountPoisha)} · counted {bdt(review.verifiedAmountPoisha)}{review.reviewedBy?.name ? ` · ${review.reviewedBy.name}` : ''}</small><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</time></li>)}</ol></details>}
      </article>)}</div>
      {handoverPages > 1 && <div className="parcel-actions"><button className="button-secondary" disabled={handoverPage <= 1 || loading} onClick={() => setHandoverPage((value) => Math.max(1, value - 1))}>Previous handovers</button><span>Page {handoverPage} of {handoverPages}</span><button className="button-secondary" disabled={handoverPage >= handoverPages || loading} onClick={() => setHandoverPage((value) => Math.min(handoverPages, value + 1))}>Next handovers</button></div>}
    </section>
  </DashboardLayout>;
}

export function OperationsPortal() {
  const { user } = useAuth();
  const [parcels, setParcels] = useState([]); const [riders, setRiders] = useState([]); const [decisionNotes, setDecisionNotes] = useState({}); const [deliveryAmounts, setDeliveryAmounts] = useState({}); const [activity, setActivity] = useState({}); const [activityLoading, setActivityLoading] = useState({}); const [activityErrors, setActivityErrors] = useState({}); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [page, setPage] = useState(1); const [pages, setPages] = useState(1); const [statusFilter, setStatusFilter] = useState(''); const [trackingSearch, setTrackingSearch] = useState(''); const [searchInput, setSearchInput] = useState('');
  const refresh = useCallback(async () => { setLoading(true); setError(''); try { const query = new URLSearchParams({ page: String(page), limit: '25' }); if (statusFilter) query.set('status', statusFilter); if (trackingSearch) query.set('q', trackingSearch); const [p, r] = await Promise.all([api.get(`/api/operations/parcels?${query}`), api.get('/api/operations/parcels/riders')]); setParcels(p.data.items); setPages(p.data.pages || 1); setRiders(r.data.items); } catch (e) { setError(responseError(e, 'Unable to load operations queue.')); } finally { setLoading(false); } }, [page, statusFilter, trackingSearch]);
  useEffect(() => { refresh(); }, [refresh]);
  const loadActivity = async (parcelId, targetPage = activity[parcelId]?.page || 1) => {
    setActivityLoading((previous) => ({ ...previous, [parcelId]: true }));
    setActivityErrors((previous) => ({ ...previous, [parcelId]: '' }));
    try {
      const query = new URLSearchParams({ page: String(targetPage), limit: '20' });
      const { data } = await api.get(`/api/operations/parcels/${parcelId}/events?${query}`);
      setActivity((previous) => ({ ...previous, [parcelId]: data }));
    } catch (requestError) {
      setActivityErrors((previous) => ({ ...previous, [parcelId]: responseError(requestError, 'Unable to load parcel activity.') }));
    } finally { setActivityLoading((previous) => ({ ...previous, [parcelId]: false })); }
  };
  useEffect(() => {
    const socket = connectSocket();
    socket.on('parcelChanged', refresh);
    socket.on('parcelRequested', refresh);
    return () => socket.disconnect();
  }, [refresh]);
  const move = async (parcel, status, note = '') => { const reason = note.trim(); setBusy(parcel._id); setError(''); try { await runIdempotent(`transition:${parcel._id}:${status}:${reason}`, (key) => api.put(`/api/operations/parcels/${parcel._id}/transition`, { status, note: reason }, { headers: { 'Idempotency-Key': key } })); setDecisionNotes((previous) => ({ ...previous, [parcel._id]: '' })); setNotice(`${parcel.trackingCode} moved to ${status}.`); await refresh(); } catch (e) { setError(responseError(e, 'Unable to update parcel.')); } finally { setBusy(''); } };
  const confirmDelivery = async (parcel) => {
    const collectedAmountPoisha = parcel.paymentType === 'COD' ? decimalToInteger(deliveryAmounts[parcel._id]) : 0;
    if (collectedAmountPoisha === null) { setError('Enter the COD amount as BDT with up to 2 decimal places.'); return; }
    setBusy(parcel._id); setError('');
    try {
      await runIdempotent(`delivery:${parcel._id}:${collectedAmountPoisha}`, (key) => api.post(`/api/finance/deliveries/${parcel._id}/confirm`, { collectedAmountPoisha }, { headers: { 'Idempotency-Key': key } }));
      setDeliveryAmounts((previous) => ({ ...previous, [parcel._id]: '' }));
      setNotice(`${parcel.trackingCode} marked delivered${parcel.paymentType === 'COD' ? ' and cash collection recorded' : ''}.`);
      await refresh();
    } catch (e) { setError(responseError(e, 'Unable to confirm delivery.')); }
    finally { setBusy(''); }
  };
  const assign = async (parcelId, riderId) => { if (!riderId) return; const body = { riderId }; setBusy(parcelId); setError(''); try { await runIdempotent(`rider-assignment:${parcelId}:${riderId}`, (key) => api.patch(`/api/operations/parcels/${parcelId}/rider`, body, { headers: { 'Idempotency-Key': key } })); await refresh(); } catch (e) { setError(responseError(e, 'Unable to assign rider.')); } finally { setBusy(''); } };
  const eligibleRiders = (parcel) => {
    const branchId = ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(parcel.status) ? parcel.originBranchId : parcel.destinationBranchId;
    return riders.filter((rider) => (rider.branchIds || []).some((id) => idOf(id) === idOf(branchId)));
  };
  const canOperateAt = (branchId) => user?.role === 'admin' || (user?.branchIds || []).some((id) => idOf(id) === idOf(branchId));
  const actionBranch = (parcel, status) => status === 'Cancelled'
    ? parcel.status === 'Delivery Failed' ? parcel.destinationBranchId : parcel.originBranchId
    : ['Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(status) ? parcel.originBranchId : parcel.destinationBranchId;
  const currentAssignmentBranch = (parcel) => ['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit'].includes(parcel.status)
    ? parcel.originBranchId
    : parcel.destinationBranchId;
  const next = { Processing: ['Booked', 'Cancelled'], Booked: ['Picked Up', 'Cancelled'], 'Picked Up': ['At Origin Hub'], 'At Origin Hub': ['In Transit'], 'In Transit': ['At Destination Hub'], 'At Destination Hub': ['Out for Delivery'], 'Delivery Failed': ['Out for Delivery', 'Cancelled'] };
  return <DashboardLayout role="operations" title="Branch operations." description="Review merchant bookings, route parcels through hubs, and assign branch riders.">
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <StaffBookingForm onCreated={refresh} />
    <section className="panel" id="parcels"><div className="panel-heading"><div><h2>Parcel queue</h2><p>Branch-scoped, paginated operations list.</p></div><div className="parcel-actions"><form className="inline-search" role="search" onSubmit={(event) => { event.preventDefault(); setTrackingSearch(searchInput.trim().slice(0, 40)); setPage(1); }}><label className="sr-only" htmlFor="operations-tracking-search">Search tracking code</label><input id="operations-tracking-search" maxLength="40" placeholder="Tracking code prefix" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button className="button-secondary">Search</button></form><select aria-label="Filter operations status" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}><option value="">All statuses</option>{['Processing', 'Booked', 'Picked Up', 'At Origin Hub', 'In Transit', 'At Destination Hub', 'Out for Delivery', 'Delivered', 'Delivery Failed', 'Cancelled'].map((status) => <option key={status} value={status}>{status}</option>)}</select><button className="button-secondary" onClick={refresh}>Refresh</button></div></div>
      {loading && <EmptyState loading title="Loading queue" description="" />}{!loading && !error && !parcels.length && <EmptyState title="Queue is clear" description="New bookings in your branch will appear here." />}
      <div className="parcel-list">{parcels.map((parcel) => { const eligible = eligibleRiders(parcel); const assigned = parcel.riderId; const assignedMissing = assigned && !eligible.some((rider) => String(rider._id) === String(assigned._id)); const canAssign = canOperateAt(currentAssignmentBranch(parcel)); const availableTransitions = (next[parcel.status] || []).filter((status) => canOperateAt(actionBranch(parcel, status))); const canConfirmDelivery = parcel.status === 'Out for Delivery' && canOperateAt(parcel.destinationBranchId) && (user?.role === 'admin' || (user?.role === 'operations' && parcel.paymentType === 'prepaid')); const closed = ['Delivered', 'Cancelled', 'Failed'].includes(parcel.status); const hasActions = canAssign || availableTransitions.length > 0 || canConfirmDelivery; return <article className="parcel-card" key={parcel._id}><div className="parcel-card-heading"><strong>{parcel.trackingCode || `#${parcel._id.slice(-8).toUpperCase()}`}</strong><StatusBadge status={parcel.status} /></div><p>Merchant: {parcel.merchantId?.name || 'Unknown merchant'}</p><p>Origin hub: {parcel.originBranchId?.name || '—'} · Destination hub: {parcel.destinationBranchId?.name || '—'}</p><ParcelRoute pickup={parcel.pickupAddress} delivery={parcel.deliveryAddress} />
        {parcel.recipientName && <p>Recipient: <strong>{parcel.recipientName}</strong>{parcel.recipientPhone && <> · <a href={`tel:${parcel.recipientPhone}`}>{parcel.recipientPhone}</a></>}</p>}
        {parcel.proofs?.length > 0 && <div className="parcel-actions"><strong>Delivery proof:</strong>{parcel.proofs.map((proof) => <a className="button-secondary" key={proof._id} href={`${API_URL}/api/rider/proofs/${proof._id}`} target="_blank" rel="noreferrer">Download photo</a>)}</div>}
        {!closed && hasActions && <div className="parcel-actions">{canAssign && <><select aria-label={`Assign rider for ${parcel.trackingCode}`} value={assigned?._id || ''} disabled={Boolean(busy)} onChange={(e) => assign(parcel._id, e.target.value)}><option value="">Assign branch rider</option>{assignedMissing && <option value={assigned._id} disabled>{assigned.name} · branch access changed</option>}{eligible.map((rider) => <option key={rider._id} value={rider._id}>{rider.name}</option>)}</select>{!eligible.length && <small>No active rider is assigned to this parcel's current branch.</small>}</>}{parcel.status === 'Delivery Failed' && availableTransitions.length > 0 && <label>Reason for retry or cancellation (required)<textarea required minLength={8} maxLength={1000} value={decisionNotes[parcel._id] || ''} onChange={(event) => setDecisionNotes((previous) => ({ ...previous, [parcel._id]: event.target.value }))} /></label>}{availableTransitions.map((status) => { const needsDecisionReason = parcel.status === 'Delivery Failed'; return <button className="button-secondary" key={status} disabled={Boolean(busy) || (needsDecisionReason && (decisionNotes[parcel._id] || '').trim().length < 8)} onClick={() => move(parcel, status, needsDecisionReason ? decisionNotes[parcel._id] || '' : '')}>{busy === parcel._id ? 'Saving…' : status}</button>; })}{canConfirmDelivery && <>{parcel.paymentType === 'COD' && <label>Cash collected (BDT; due {bdt(parcel.priceSnapshot?.codAmountPoisha || 0)})<input required type="number" min="0" step="0.01" inputMode="decimal" value={deliveryAmounts[parcel._id] || ''} onChange={(event) => setDeliveryAmounts((previous) => ({ ...previous, [parcel._id]: event.target.value }))} /></label>}<button className="button-primary" disabled={Boolean(busy) || (parcel.paymentType === 'COD' && decimalToInteger(deliveryAmounts[parcel._id]) === null)} onClick={() => confirmDelivery(parcel)}>{busy === parcel._id ? 'Saving…' : `Confirm delivered${parcel.paymentType === 'COD' ? ' & cash received' : ''}`}</button></>}</div>}
        {parcel.status === 'Out for Delivery' && parcel.paymentType === 'COD' && user?.role === 'operations' && canOperateAt(parcel.destinationBranchId) && <p className="field-hint">The assigned rider or an admin must record COD collection and confirm delivery.</p>}
        <button className="button-secondary" aria-expanded={Boolean(activity[parcel._id])} onClick={() => loadActivity(parcel._id)} disabled={activityLoading[parcel._id]}>{activityLoading[parcel._id] ? 'Loading activity…' : activity[parcel._id] ? 'Refresh parcel activity' : 'View parcel activity'}</button>{activityErrors[parcel._id] && <p role="alert" className="alert">{activityErrors[parcel._id]}</p>}{activity[parcel._id] && <><ol className="event-list">{activity[parcel._id].items.map((event) => <li key={event._id}><strong>{event.toStatus || event.type.replaceAll('_', ' ')}</strong>{event.branchId && <small>{event.branchId.name}{event.branchId.city ? ` · ${event.branchId.city}` : ''}</small>}{event.note && <small>{event.note}</small>}<time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })} · {event.actorRole}</time></li>)}</ol>{activity[parcel._id].pages > 1 && <div className="parcel-actions"><button className="button-secondary" disabled={activity[parcel._id].page >= activity[parcel._id].pages || activityLoading[parcel._id]} onClick={() => loadActivity(parcel._id, activity[parcel._id].page + 1)}>Older activity</button><span>Activity page {activity[parcel._id].page} of {activity[parcel._id].pages}</span><button className="button-secondary" disabled={activity[parcel._id].page <= 1 || activityLoading[parcel._id]} onClick={() => loadActivity(parcel._id, activity[parcel._id].page - 1)}>Newer activity</button></div>}</>}
        {!closed && !hasActions && <p className="field-hint">This parcel is visible to your branch, but its current actions belong to the other handling branch.</p>}
      </article>;})}</div><div className="parcel-actions"><button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page} of {pages}</span><button className="button-secondary" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>Next</button></div>
    </section>
    {user?.role === 'admin' && <section className="panel section-gap"><h2>Merchant approvals</h2><p>Admin approval controls whether a merchant can create bookings.</p><Link className="button-primary" to="/admin#merchant-applications">Open approvals</Link></section>}
  </DashboardLayout>;
}

function StaffBookingForm({ onCreated }) {
  const emptyForm = { merchantEmail: '', pickupAddress: '', deliveryAddress: '', recipientName: '', recipientPhone: '', parcelType: '', originBranchId: '', destinationBranchId: '', paymentType: 'COD', codAmount: '' };
  const [form, setForm] = useState(emptyForm);
  const [originBranches, setOriginBranches] = useState([]);
  const [destinationBranches, setDestinationBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    api.get('/api/operations/bookings/options')
      .then(({ data }) => {
        if (!active) return;
        setOriginBranches(data.originBranches);
        setDestinationBranches(data.destinationBranches);
        setForm((previous) => ({ ...previous, originBranchId: data.originBranches[0]?._id || '', destinationBranchId: data.destinationBranches[0]?._id || '' }));
      })
      .catch((requestError) => { if (active) setError(responseError(requestError, 'Unable to load booking branches.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const codAmountPoisha = form.paymentType === 'COD' ? decimalToInteger(form.codAmount) : 0;
    if (codAmountPoisha === null) { setError('Enter a COD amount with no more than two decimal places.'); setSaving(false); return; }
    const body = { ...form, merchantEmail: form.merchantEmail.trim().toLowerCase(), codAmountPoisha };
    try {
      const result = await runIdempotent(`staff-booking:${JSON.stringify(body)}`, (key) => api.post('/api/operations/bookings', body, { headers: { 'Idempotency-Key': key } }));
      setNotice(`Booking created for the approved merchant. Tracking code: ${result.data.trackingCode}`);
      setForm((previous) => ({ ...emptyForm, originBranchId: previous.originBranchId, destinationBranchId: previous.destinationBranchId }));
      await onCreated();
    } catch (requestError) { setError(responseError(requestError, 'Unable to create booking.')); }
    finally { setSaving(false); }
  };
  const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  return <section className="panel section-gap" id="staff-booking">
    <div className="panel-heading"><div><h2>Create a booking</h2><p>For phone or counter requests from an approved merchant. The booking remains owned by that merchant.</p></div></div>
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    {loading ? <EmptyState loading title="Loading active branches" description="" /> : error ? null : !originBranches.length || !destinationBranches.length ? <EmptyState title="No active booking branches" description="Add or activate a branch before creating a booking." /> : <form className="booking-form" onSubmit={submit}>
      <label>Approved merchant email<input required type="email" autoComplete="email" value={form.merchantEmail} onChange={(event) => set('merchantEmail', event.target.value)} /></label>
      <label>Pickup branch<select required value={form.originBranchId} onChange={(event) => set('originBranchId', event.target.value)}>{originBranches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} · {branch.city}</option>)}</select></label>
      <label>Destination branch<select required value={form.destinationBranchId} onChange={(event) => set('destinationBranchId', event.target.value)}>{destinationBranches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} · {branch.city}</option>)}</select></label>
      <label>Pickup address<input required maxLength={500} value={form.pickupAddress} onChange={(event) => set('pickupAddress', event.target.value)} /></label>
      <label>Delivery address<input required maxLength={500} value={form.deliveryAddress} onChange={(event) => set('deliveryAddress', event.target.value)} /></label>
      <label>Recipient name<input required maxLength={120} value={form.recipientName} onChange={(event) => set('recipientName', event.target.value)} /></label>
      <label>Recipient mobile<input required type="tel" inputMode="tel" pattern="(?:\\+?8801|01)[3-9][0-9]{8}" title="Enter a Bangladesh mobile number, e.g. 017XXXXXXXX" value={form.recipientPhone} onChange={(event) => set('recipientPhone', event.target.value)} /></label>
      <label>Parcel contents<input required maxLength={120} value={form.parcelType} onChange={(event) => set('parcelType', event.target.value)} /></label>
      <label>Payment<select value={form.paymentType} onChange={(event) => set('paymentType', event.target.value)}><option value="COD">Cash on delivery</option><option value="prepaid">Prepaid</option></select></label>
      {form.paymentType === 'COD' && <label>COD amount (BDT)<input required type="number" min="0" step="0.01" inputMode="decimal" value={form.codAmount} onChange={(event) => set('codAmount', event.target.value)} /></label>}
      <button className="button-primary" disabled={saving}>{saving ? 'Creating booking…' : 'Create booking'}</button>
    </form>}
  </section>;
}

export function AccountsPortal() {
  const [handovers, setHandovers] = useState([]); const [payouts, setPayouts] = useState([]); const [ledger, setLedger] = useState([]); const [references, setReferences] = useState({}); const [verifiedAmounts, setVerifiedAmounts] = useState({}); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [reversalNotes, setReversalNotes] = useState({}); const [rejectionNotes, setRejectionNotes] = useState({}); const { user } = useAuth();
  const [filters, setFilters] = useState({ handover: '', payout: '', ledger: '' });
  const [pages, setPages] = useState({ handover: 1, payout: 1, ledger: 1 });
  const [pageCounts, setPageCounts] = useState({ handover: 1, payout: 1, ledger: 1 });
  const changeFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPages((current) => ({ ...current, [key]: 1 })); };
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const handoverQuery = new URLSearchParams({ page: String(pages.handover), limit: '20' }); if (filters.handover) handoverQuery.set('status', filters.handover);
      const payoutQuery = new URLSearchParams({ page: String(pages.payout), limit: '20' }); if (filters.payout) payoutQuery.set('status', filters.payout);
      const ledgerQuery = new URLSearchParams({ page: String(pages.ledger), limit: '25' }); if (filters.ledger) ledgerQuery.set('type', filters.ledger);
      const [h, p, l] = await Promise.all([api.get(`/api/finance/cash-handovers?${handoverQuery}`), api.get(`/api/finance/payouts?${payoutQuery}`), api.get(`/api/finance/ledger?${ledgerQuery}`)]);
      setHandovers(h.data.items); setPayouts(p.data.items); setLedger(l.data.items);
      const counts = { handover: h.data.pages || 1, payout: p.data.pages || 1, ledger: l.data.pages || 1 };
      setPageCounts(counts);
      setPages((current) => Object.keys(counts).every((key) => current[key] <= counts[key]) ? current : Object.fromEntries(Object.keys(counts).map((key) => [key, Math.min(current[key], counts[key])] )));
    } catch (e) { setError(responseError(e, 'Unable to load accounts workspace.')); } finally { setLoading(false); }
  }, [filters, pages]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const socket = connectSocket();
    socket.on('cashHandoverChanged', refresh);
    socket.on('payoutChanged', refresh);
    return () => socket.disconnect();
  }, [refresh]);
  const act = async (url, body, success) => { setError(''); setNotice(''); try { await runIdempotent(`accounts:${url}:${JSON.stringify(body)}`, (key) => api.patch(url, body, { headers: { 'Idempotency-Key': key } })); setNotice(success); await refresh(); } catch (e) { setError(responseError(e, 'Unable to save accounts action.')); } };
  const reconcileHandover = (handover) => {
    const verifiedAmountPoisha = decimalToInteger(verifiedAmounts[handover._id]);
    if (verifiedAmountPoisha === null) { setError('Enter the physical cash count using at most two decimal places.'); return; }
    return act(`/api/finance/cash-handovers/${handover._id}/reconcile`, { verifiedAmountPoisha }, 'Counted cash amount recorded for reconciliation.');
  };
  const reverseLedger = async (entryId) => { const body = { note: reversalNotes[entryId] }; setError(''); setNotice(''); try { await runIdempotent(`cod-payable-reversal:${entryId}:${body.note}`, (key) => api.post(`/api/finance/ledger/${entryId}/reverse`, body, { headers: { 'Idempotency-Key': key } })); setNotice('COD payable reversed with an immutable ledger entry.'); await refresh(); } catch (e) { setError(responseError(e, 'Unable to reverse ledger entry.')); } };
  const pager = (key) => <div className="parcel-actions" aria-label={`${key} pagination`}><button className="button-secondary" disabled={pages[key] <= 1 || loading} onClick={() => setPages((current) => ({ ...current, [key]: Math.max(1, current[key] - 1) }))}>Previous</button><span>Page {pages[key]} of {pageCounts[key]}</span><button className="button-secondary" disabled={pages[key] >= pageCounts[key] || loading} onClick={() => setPages((current) => ({ ...current, [key]: Math.min(pageCounts[key], current[key] + 1) }))}>Next</button></div>;
  return <DashboardLayout role="accounts" title="Cash in. Payables verified." description="Reconcile branch cash by verified count, then approve and record confirmed merchant payout references.">
    {error && <p role="alert" className="alert">{error}</p>}{notice && <p role="status" className="success-message">{notice}</p>}
    <div className="customer-grid"><section className="panel" id="cash-handovers"><div className="panel-heading"><h2>Rider cash handovers</h2><label>Filter handovers<select aria-label="Filter handover status" value={filters.handover} onChange={(event) => changeFilter('handover', event.target.value)}><option value="">All statuses</option><option value="submitted">Submitted</option><option value="disputed">Disputed</option><option value="reconciled">Reconciled</option></select></label></div>{loading && <EmptyState loading title="Loading handovers" description="" />}{!loading && !error && !handovers.length && <EmptyState title="No cash handovers" description="No handovers match this filter on this page." />}
      <div className="parcel-list">{handovers.map((h) => <article className="parcel-card" key={h._id}><div className="parcel-card-heading"><strong>{h.riderId?.name} · {h.branchId?.name}</strong><StatusBadge status={h.status} /></div><p>Expected from recorded collections {bdt(h.expectedAmountPoisha)} · Rider declared {bdt(h.declaredAmountPoisha)}{h.verifiedAmountPoisha !== undefined && ` · Physically counted ${bdt(h.verifiedAmountPoisha)}`}</p>{h.parcelIds?.length > 0 && <details><summary>Included parcels ({h.parcelIds.length})</summary><ul className="event-list">{h.parcelIds.map((parcel) => parcel && <li key={parcel._id}><strong>{parcel.trackingCode}</strong><small>COD snapshot {bdt(parcel.priceSnapshot?.codAmountPoisha || 0)} · rider-recorded collection {bdt(parcel.cod?.collectedAmountPoisha || 0)}</small><small>Parcel status: {parcel.status}</small></li>)}</ul></details>}{h.reviewAttempts?.length > 0 && <details><summary>Count review history ({h.reviewAttempts.length})</summary><ol className="event-list">{h.reviewAttempts.map((attempt) => <li key={attempt._id}><strong>Attempt {attempt.attemptNumber}: {attempt.outcome}</strong><span>Expected {bdt(attempt.expectedAmountPoisha)} · Counted {bdt(attempt.verifiedAmountPoisha)} · {attempt.reviewedBy?.name || 'Accounts'}</span><time dateTime={attempt.createdAt}>{new Date(attempt.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</time></li>)}</ol></details>}{h.status !== 'reconciled' && <><label>Cash physically counted (BDT)<input required aria-label={`Cash physically counted for handover ${h._id}`} type="number" min="0" step="0.01" value={verifiedAmounts[h._id] || ''} onChange={(event) => setVerifiedAmounts({ ...verifiedAmounts, [h._id]: event.target.value })} /></label><button className="button-primary" disabled={!verifiedAmounts[h._id]} onClick={() => reconcileHandover(h)}>{h.status === 'disputed' ? 'Recheck counted cash' : 'Record counted cash'}</button></>}</article>)}</div>
      {pager('handover')}
    </section><section className="panel" id="payouts"><div className="panel-heading"><h2>Merchant payouts</h2><label>Filter payouts<select aria-label="Filter payout status" value={filters.payout} onChange={(event) => changeFilter('payout', event.target.value)}><option value="">All statuses</option>{['requested', 'approved', 'paid', 'reversed', 'rejected'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label></div>{loading && <EmptyState loading title="Loading payouts" description="" />}{!loading && !error && !payouts.length && <EmptyState title="No payouts" description="No payout requests match this filter on this page." />}{payouts.map((p) => <article className="parcel-card" key={p._id}><div className="parcel-card-heading"><strong>{p.merchantId?.name} · {bdt(p.amountPoisha)}</strong><StatusBadge status={p.status} /></div>{p.parcelIds?.length > 0 && <details><summary>Included parcels ({p.parcelIds.length})</summary><ul className="event-list">{p.parcelIds.map((parcel) => parcel && <li key={parcel._id}><strong>{parcel.trackingCode}</strong><small>Merchant net snapshot {bdt(parcel.priceSnapshot?.merchantNetPoisha || 0)} · COD status {parcel.cod?.status || 'not applicable'}</small></li>)}</ul></details>}{p.reviewedAt && <small>Reviewed {new Date(p.reviewedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}{p.reviewedBy?.name ? ` · ${p.reviewedBy.name}` : ''}</small>}{p.status === 'rejected' && p.reviewNote && <small>Rejection reason: {p.reviewNote}</small>}{p.paidAt && <small>Payment recorded {new Date(p.paidAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}{p.paidBy?.name ? ` · ${p.paidBy.name}` : ''}</small>}{p.status === 'requested' && <><label>Reason for rejecting payout (required)<textarea required minLength={8} maxLength={1000} value={rejectionNotes[p._id] || ''} onChange={(event) => setRejectionNotes((previous) => ({ ...previous, [p._id]: event.target.value }))} /></label><div className="parcel-actions"><button className="button-primary" onClick={() => act(`/api/finance/payouts/${p._id}`, { action: 'approve' }, 'Payout approved.')}>Approve</button><button className="button-secondary" disabled={(rejectionNotes[p._id] || '').trim().length < 8} onClick={() => act(`/api/finance/payouts/${p._id}`, { action: 'reject', note: rejectionNotes[p._id] }, 'Payout request rejected with a reason.')}>Reject with reason</button></div></>}{p.status === 'approved' && <><label>Confirmed bank/MFS reference<input required value={references[p._id] || ''} onChange={(e) => setReferences({ ...references, [p._id]: e.target.value })} /></label><button className="button-primary" disabled={!references[p._id]?.trim()} onClick={() => act(`/api/finance/payouts/${p._id}`, { action: 'mark-paid', paymentReference: references[p._id] }, 'Payout recorded with confirmation reference.')}>Record confirmed payment</button></>}{p.status === 'paid' && <><small>Confirmation: {p.paymentReference}</small>{user?.role === 'admin' && <><label>Confirmed return reference<input value={references[`reverse-${p._id}`] || ''} onChange={(e) => setReferences({ ...references, [`reverse-${p._id}`]: e.target.value })} /></label><label>Reversal reason<input value={reversalNotes[p._id] || ''} onChange={(e) => setReversalNotes({ ...reversalNotes, [p._id]: e.target.value })} /></label><button className="button-secondary" disabled={!references[`reverse-${p._id}`] || (reversalNotes[p._id] || '').trim().length < 8} onClick={() => act(`/api/finance/payouts/${p._id}`, { action: 'reverse', paymentReference: references[`reverse-${p._id}`], note: reversalNotes[p._id] }, 'Confirmed payout reversal recorded.')}>Record confirmed reversal</button></>}</>}{p.status === 'reversed' && <><small>Original payment: {p.paymentReference}</small><small>Return reference: {p.reversalReference}</small><small>Reversal reason: {p.reversalNote}</small><small>Reversed {new Date(p.reversedAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}{p.reversedBy?.name ? ` · ${p.reversedBy.name}` : ''}</small></>}</article>)}{pager('payout')}
      <div className="section-gap"><div className="panel-heading"><h2>Company ledger</h2><label>Filter entries<select aria-label="Filter ledger type" value={filters.ledger} onChange={(event) => changeFilter('ledger', event.target.value)}><option value="">All entries</option>{['cod_payable', 'payout_paid', 'reversal', 'adjustment'].map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label></div>{loading && <EmptyState loading title="Loading ledger" description="" />}{!loading && !error && !ledger.length && <EmptyState title="No ledger entries" description="Entries will appear after cash reconciliation or payout activity." />}{ledger.map((entry) => <article className="parcel-card" key={entry._id}><div className="parcel-card-heading"><strong>{entry.merchantId?.name} · {entry.type.replaceAll('_', ' ')}</strong><strong>{bdt(entry.amountPoisha)}</strong></div><small>{entry.parcelId ? `Parcel ${entry.parcelId}` : `Payout ${entry.payoutId}`} · {new Date(entry.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}{entry.externalReference ? ` · Ref ${entry.externalReference}` : ''}</small>{entry.reversed && entry.reversal && <small>Reversed {new Date(entry.reversal.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })} · Ref {entry.reversal.externalReference || 'not provided'} · Reversal ledger entry {String(entry.reversal._id)}</small>}{entry.reversal?.note && <small>Reversal reason: {entry.reversal.note}</small>}{entry.reversesEntryId && <small>Reverses ledger entry {String(entry.reversesEntryId)}</small>}{entry.note && <small>Note: {entry.note}</small>}{user?.role === 'admin' && entry.type === 'cod_payable' && !entry.reversed && <><label>Reversal reason<input value={reversalNotes[entry._id] || ''} onChange={(e) => setReversalNotes({ ...reversalNotes, [entry._id]: e.target.value })} /></label><button className="button-secondary" disabled={(reversalNotes[entry._id] || '').trim().length < 8} onClick={() => reverseLedger(entry._id)}>Reverse COD payable</button></>}</article>)}{pager('ledger')}</div>
    </section></div>
  </DashboardLayout>;
}

export function PublicTracking() {
  const [code, setCode] = useState(''); const [result, setResult] = useState(null); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const track = async (event) => { event.preventDefault(); setLoading(true); setResult(null); setError(''); try { const response = await api.get(`/api/merchants/track/${encodeURIComponent(code.trim())}`); setResult(response.data); } catch (e) { setError(responseError(e, 'Tracking code not found.')); } finally { setLoading(false); } };
  useEffect(() => {
    const trackingCode = result?.trackingCode;
    if (!trackingCode || ['Delivered', 'Cancelled'].includes(result.status)) return undefined;
    let active = true;
    let pending = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const response = await api.get(`/api/merchants/track/${encodeURIComponent(trackingCode)}`);
        if (active) setResult(response.data);
      } catch {
        // Keep the last known public tracking result visible during a temporary network failure.
      } finally { pending = false; }
    }, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [result?.trackingCode, result?.status]);
  return <main className="auth-layout"><section className="auth-main"><h1>Track a parcel</h1><p>Enter the tracking code provided when the booking was accepted.</p><form className="auth-form" onSubmit={track}><label>Tracking code<input autoCapitalize="characters" required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label><button className="button-primary" disabled={loading}>{loading ? 'Looking up…' : 'Track parcel'}</button></form>{error && <p role="alert" className="alert">{error}</p>}{result && <section className="panel"><h2>{result.trackingCode}</h2><StatusBadge status={result.status} /><p>Destination: {result.destination?.city || 'Branch pending'}</p><p role="status">Updates automatically every 60 seconds while this tab is open.</p><ol>{result.events.map((event, index) => <li key={`${event.createdAt}-${index}`}>{event.toStatus || 'Booking received'}{event.branchId && <> · {event.branchId.name}, {event.branchId.city}</>} · {new Date(event.createdAt).toLocaleString('en-BD', { timeZone: 'Asia/Dhaka' })}</li>)}</ol></section>}<p><Link to="/login">Merchant sign in</Link> · <Link to="/merchant-apply">Apply for a merchant account</Link></p></section></main>;
}
