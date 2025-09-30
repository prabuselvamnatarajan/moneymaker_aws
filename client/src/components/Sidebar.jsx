import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';


const Sidebar = () => {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem('isLoggedIn');
    navigate('/login');
  };
  return (
    <div
      className="d-flex flex-column justify-content-between align-items-start bg-dark text-white p-4 h-100"
      style={{ minHeight: '100vh', width: '100%', fontFamily: 'Segoe UI, Roboto, Arial, sans-serif', fontWeight: 400 }}
    >
      <div style={{ width: '100%' }}>
        <h3 className="mb-4" style={{ fontWeight: 600, letterSpacing: 0.5 }}>Menu</h3>
        <nav className="nav flex-column w-100 sidebar-nav">
          <NavLink
            to="/dashboard"
            className={({ isActive }) => `nav-link sidebar-link ${isActive ? 'active text-warning' : 'text-white'}`}
            style={{ fontWeight: 500, fontSize: '1.08rem', letterSpacing: 0.2 }}
          >
            Dashboard
          </NavLink>
          <NavLink
            to="/account"
            className={({ isActive }) => `nav-link sidebar-link ${isActive ? 'active text-warning' : 'text-white'}`}
            style={{ fontWeight: 500, fontSize: '1.08rem', letterSpacing: 0.2 }}
          >
            Account
          </NavLink>
          <NavLink
            to="/strategies"
            className={({ isActive }) => `nav-link sidebar-link ${isActive ? 'active text-warning' : 'text-white'}`}
            style={{ fontWeight: 500, fontSize: '1.08rem', letterSpacing: 0.2 }}
          >
            Strategies
          </NavLink>
              <NavLink
                to="/backtest"
                className={({ isActive }) => `nav-link sidebar-link ${isActive ? 'active text-warning' : 'text-white'}`}
                style={{ fontWeight: 500, fontSize: '1.08rem', letterSpacing: 0.2 }}
              >
                BackTest
              </NavLink>
        </nav>
      </div>
      <button onClick={handleLogout} className="btn btn-outline-light mt-4 w-100" style={{ fontWeight: 500, fontSize: '1rem' }}>Logout</button>
    </div>
  );
};

export default Sidebar;
