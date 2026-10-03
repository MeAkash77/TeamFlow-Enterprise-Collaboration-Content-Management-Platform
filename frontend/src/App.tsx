import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { can } from './api';
import Login from './pages/Login';
import Documents from './pages/Documents';
import DocumentView from './pages/DocumentView';
import Activity from './pages/Activity';
import Integrations from './pages/Integrations';
import Admin from './pages/Admin';

export default function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return <p className="center" role="status">Loading…</p>;
  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <header className="top">
        <strong className="brand">Team<em>Flow</em></strong>
        <nav aria-label="Primary">
          <NavLink to="/">Documents</NavLink>
          <NavLink to="/activity">Activity</NavLink>
          <NavLink to="/integrations">Integrations</NavLink>
          {can(user, 'admin') && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <span className="who">{user.name} <span className={`pill role-${user.role}`}>{user.role}</span>
          <button className="link" onClick={logout}>Sign out</button></span>
      </header>
      <main id="main">
        <Routes>
          <Route path="/" element={<Documents />} />
          <Route path="/docs/:id" element={<DocumentView />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/admin" element={can(user, 'admin') ? <Admin /> : <Navigate to="/" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
