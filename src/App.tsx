/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { Beaker, Calendar, Settings, User } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import Home from './pages/Home';
import Booking from './pages/Booking';
import MyReservations from './pages/MyReservations';
import Admin from './pages/Admin';

export default function App() {
  const [appName, setAppName] = useState('LabBook');
  const [defaultRoute, setDefaultRoute] = useState('/');
  const [appLogo, setAppLogo] = useState('');
  const [isSettingsLoaded, setIsSettingsLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => {
        if (data.app_name) {
          setAppName(data.app_name);
          document.title = data.app_name;
        }
        if (data.default_route) {
          setDefaultRoute(data.default_route);
        }
        if (data.app_logo) {
          setAppLogo(data.app_logo);
          const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (link) {
            link.href = data.app_logo;
          } else {
            const newLink = document.createElement('link');
            newLink.rel = 'icon';
            newLink.href = data.app_logo;
            document.head.appendChild(newLink);
          }
        }
      })
      .catch(err => console.error('Failed to load settings', err))
      .finally(() => setIsSettingsLoaded(true));
  }, []);

  if (!isSettingsLoaded) {
    return null; // or a loading spinner
  }

  const basename = defaultRoute === '/' ? '' : defaultRoute;

  if (basename && !window.location.pathname.startsWith(basename)) {
    window.location.replace(basename);
    return null;
  }

  return (
    <Router basename={basename}>
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
        <Toaster position="top-center" />
        <header className="bg-white border-b border-neutral-200 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-red-600 font-semibold text-lg tracking-tight">
              {appLogo ? (
                <img src={appLogo} alt="Logo" className="w-6 h-6 object-contain" />
              ) : (
                <Beaker className="w-6 h-6" />
              )}
              <span>{appName}</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm font-medium text-neutral-600">
              <Link to="/" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">仪器列表</span>
              </Link>
              <Link to="/my-reservations" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">我的预约</span>
              </Link>
              <Link to="/admin" className="hover:text-red-600 transition-colors flex items-center gap-1.5">
                <Settings className="w-4 h-4" />
                <span className="hidden sm:inline">管理后台</span>
              </Link>
            </nav>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/book/:id" element={<Booking />} />
            <Route path="/my-reservations" element={<MyReservations />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
