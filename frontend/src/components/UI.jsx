import { Link, useLocation } from 'react-router-dom';
import { logout } from '../api';

export function Icon({ name = 'box', size = 20, ...props }) {
  const paths = {
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    truck: <><path d="M3 5h11v12H3zM14 9h4l3 4v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="18" cy="18" r="2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" /></>,
    logout: <path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.box}</svg>;
}

export function Brand({ light = false }) {
  return <Link to="/" className={`brand${light ? ' brand-light' : ''}`} aria-label="ParcelFlow home"><span className="brand-mark"><Icon size={25} /></span><span>Parcel<span className="brand-accent">Flow</span><small>COURIER MANAGEMENT</small></span></Link>;
}

export function AuthLayout({ children, register = false }) {
  return <main className="auth-layout">
    <section className="auth-story" aria-label="About ParcelFlow">
      <Brand light />
      <div className="story-content">
        <span className="eyebrow"><span className="tiny-dot" /> YOUR DELIVERY WORKSPACE</span>
        <h1>Every parcel.<br />One clear <span>journey.</span></h1>
        <p>A simpler way to book, manage, and follow your deliveries. Everything you need, all in one place.</p>
        <div className="journey-card">
          <div className="journey-heading"><span className="journey-icon"><Icon size={22} /></span><div><strong>From your door to theirs</strong><small>Connected at every step</small></div><Icon name="arrow" /></div>
          <div className="journey-steps"><div><span><Icon size={17} /></span><small>Book</small></div><i /><div><span><Icon name="truck" size={17} /></span><small>In transit</small></div><i /><div><span><Icon name="check" size={17} /></span><small>Delivered</small></div></div>
        </div>
        <div className="story-features"><span><Icon name="check" size={16} /> Easy booking</span><span><Icon name="check" size={16} /> Live status updates</span></div>
      </div>
      <p className="story-footer">A little less effort. A lot more clarity.</p>
    </section>
    <section className="auth-main">
      <div className="auth-topline"><span>{register ? 'Already have an account?' : 'New to ParcelFlow?'}</span><Link to={register ? '/login' : '/register'}>{register ? 'Sign in' : 'Create an account'} <Icon name="arrow" size={15} /></Link></div>
      <div className="auth-form-wrap">{children}</div>
      <p className="auth-footer"><Icon name="shield" size={16} /> Your deliveries, in good hands.</p>
    </section>
  </main>;
}

export function DashboardLayout({ role, title, description, children }) {
  const { hash } = useLocation();
  const activeSection = hash.slice(1) || 'overview';
  const navigation = role === 'customer'
    ? [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'book-parcel', label: 'Request a booking', icon: 'plus' }, { id: 'parcels', label: 'My parcels', icon: 'box' }]
    : role === 'admin'
      ? [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'bookings', label: 'Bookings', icon: 'box' }, { id: 'users', label: 'Users', icon: 'users' }]
      : [{ id: 'overview', label: 'Overview', icon: 'grid' }, { id: 'parcels', label: 'Assigned parcels', icon: 'truck' }];
  return <div className="dashboard-layout">
    <aside className="sidebar">
      <Brand />
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Workspace navigation">{navigation.map((item) => <Link to={`#${item.id}`} key={item.id} onClick={() => document.getElementById(item.id)?.scrollIntoView({ block: 'start' })} className={activeSection === item.id ? 'nav-active' : undefined} aria-current={activeSection === item.id ? 'location' : undefined}><Icon name={item.icon} />{item.label}{activeSection === item.id && <span className="nav-dot" />}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="workspace-note"><span className="tiny-dot" /><span>A smoother delivery day.<small>Keep everything moving.</small></span></div><button className="logout-button" onClick={logout}><Icon name="logout" size={18} /> Log out</button></div>
    </aside>
    <div className="dashboard-body">
      <header className="topbar"><span>Workspace <span className="breadcrumb-slash">/</span> <strong>{role.charAt(0).toUpperCase() + role.slice(1)}</strong></span><span className="role-chip"><span className="tiny-dot" />{role} account</span></header>
      <main className="dashboard-main" id="overview"><div className="page-heading"><div><p className="eyebrow">YOUR WORKSPACE, AT A GLANCE</p><h1>{title}</h1><p>{description}</p></div><span className="heading-icon"><Icon size={29} /></span></div>{children}<footer className="dashboard-footer">ParcelFlow <span>Simple. Organized. Delivered.</span></footer></main>
    </div>
  </div>;
}

export function StatCard({ label, value, icon = 'box', detail }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon name={icon} size={19} /></span></div><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

export function StatusBadge({ status }) {
  const tone = status === 'Delivered' || status === 'Booked' ? 'complete' : status === 'Failed' ? 'failed' : status === 'In Transit' || status === 'Picked Up' ? 'active' : status === 'Processing' ? 'processing' : 'pending';
  return <span className={`status-badge status-${tone}`}>{status === 'Processing' ? <Icon name="clock" size={12} /> : <span className="tiny-dot" />}{status}</span>;
}

export function EmptyState({ title, description, loading = false }) {
  return <div className="empty-state" role="status"><span className="empty-icon"><Icon name={loading ? 'clock' : 'box'} size={26} /></span><h3>{loading ? 'Loading your workspace…' : title}</h3>{!loading && <p>{description}</p>}</div>;
}

export function ParcelRoute({ pickup, delivery }) {
  return <div className="parcel-route"><div><span className="route-marker" /><p><small>PICKUP</small>{pickup}</p></div><div><span className="route-marker destination" /><p><small>DELIVERY</small>{delivery}</p></div></div>;
}
