

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';


import Dashboard from './pages/Dashboard';
import Account from './pages/Account';
import Strategies from './pages/Strategies';
import BackTest from './pages/BackTest';
import Sidebar from './components/Sidebar';
import './App.css';



function App() {
  React.useEffect(() => {
    localStorage.setItem('isLoggedIn', 'true');
  }, []);
  // Get appAddress from env (Vite convention: VITE_APP_ADDRESS)
  const appAddress = import.meta.env.VITE_APP_ADDRESS;
  return (
    <Router>
      <div className="container-fluid col-12" style={{ minHeight: '100vh', padding: 0, width: '100vw', maxWidth: '100vw' }}>
        <div className="row g-0" style={{ minHeight: '100vh' }}>
          <div className="col-lg-3 col-md-4 col-12 bg-light" style={{ minHeight: '100vh', padding: 0 }}>
            <Sidebar />
          </div>
          <div className="col-lg-9 col-md-8 col-12" style={{ minHeight: '100vh', padding: 24 }}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/account" element={<Account appAddress={appAddress} />} />
              <Route path="/strategies" element={<Strategies appAddress={appAddress} />} />
              <Route path="/backtest" element={<BackTest appAddress={appAddress} />} />
              <Route path="*" element={<Navigate to="/dashboard" />} />
            </Routes>
          </div>
        </div>
      </div>
    </Router>
  );
}

export default App;
