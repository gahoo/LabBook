/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import { Beaker, Calendar, Settings, User } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import Home from './pages/Home';
import Booking from './pages/Booking';
import MyReservations from './pages/MyReservations';
import Admin from './pages/Admin';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
        <Toaster position="top-center" />
        <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center gap-2 text-red-600 font-semibold text-lg tracking-tight">
              <Beaker className="w-6 h-6" />
              <span>LabBook</span>
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
