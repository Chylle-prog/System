import { Link, useLocation } from 'react-router-dom';
import { FaSignInAlt, FaUserPlus, FaBars, FaTimes, FaSignOutAlt, FaTachometerAlt } from 'react-icons/fa';
import { useState } from 'react';
import { PROVIDER_DASHBOARD_ROUTE, isProviderDashboardRole } from '../../Pages/Dash/provider-dashboard-config';
import { clearAdminSession } from '../../utils/admin-session';
import logo from '../../assets/logo.png';

const Navbar = () => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const userRole = localStorage.getItem('userRole') || '';
  const dashboardPath = isProviderDashboardRole(userRole) ? PROVIDER_DASHBOARD_ROUTE : '/dash';

  // Check if current route is a dashboard route
  const isDashboardRoute = ['/dash', PROVIDER_DASHBOARD_ROUTE, '/dash-africa', '/dash-vilma', '/dash-tulong'].includes(location.pathname);

  const handleLogout = () => {
    clearAdminSession();
    window.location.href = '/login';
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-lg border-b border-gray-800 shadow-lg transition-all duration-300">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between relative">
        {/* Left side - Logo/Brand */}
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center overflow-hidden shadow-sm group-hover:shadow-md transition-all duration-300">
              <img src={logo} alt="Iskomats Logo" className="w-10 h-10 object-contain" />
            </div>
            <div>
              <span className="text-2xl font-bold text-white group-hover:text-red-500 transition-colors">
                Iskomats
              </span>
              <p className="text-xs text-gray-400">Scholarship Portal</p>
            </div>
          </Link>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-4">
          {isDashboardRoute ? (
            <>
              <Link
                to={dashboardPath}
                className="px-6 py-3 rounded-xl border-2 border-gray-600 text-gray-300 font-semibold text-sm transition-all duration-300 hover:border-transparent hover:bg-gradient-to-r hover:from-red-800 hover:to-red-700 hover:text-white hover:shadow-xl hover:-translate-y-1"
              >
                <FaTachometerAlt className="inline mr-2" />
                Dashboard
              </Link>

              <button
                onClick={handleLogout}
                className="px-6 py-3 rounded-xl border-2 border-red-600 text-red-300 font-semibold text-sm transition-all duration-300 hover:border-transparent hover:bg-red-600 hover:text-white hover:shadow-xl hover:-translate-y-1"
              >
                <FaSignOutAlt className="inline mr-2" />
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="px-6 py-3 rounded-xl border-2 border-gray-600 text-gray-300 font-semibold text-sm transition-all duration-300 hover:border-transparent hover:bg-gradient-to-r hover:from-red-800 hover:to-red-700 hover:text-white hover:shadow-xl hover:-translate-y-1"
              >
                <FaSignInAlt className="inline mr-2" />
                Login
              </Link>

              <Link
                to="/register"
                className="px-6 py-3 rounded-xl border-2 border-gray-600 text-gray-300 font-semibold text-sm transition-all duration-300 hover:border-transparent hover:bg-gradient-to-r hover:from-red-800 hover:to-red-700 hover:text-white hover:shadow-xl hover:-translate-y-1"
              >
                <FaUserPlus className="inline mr-2" />
                Register
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden p-3 rounded-xl bg-gradient-to-r from-red-800 to-red-700 text-white transition-all duration-300 hover:shadow-lg"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        >
          {isMobileMenuOpen ? <FaTimes className="text-xl" /> : <FaBars className="text-xl" />}
        </button>
      </div>

      {/* Mobile menu */}
      <div className={`md:hidden absolute top-full left-0 right-0 bg-gray-900/95 backdrop-blur-lg border-b border-gray-800 shadow-lg transition-all duration-300 ${isMobileMenuOpen ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}>
        <div className="p-4 space-y-2">
          {isDashboardRoute ? (
            <>
              <Link
                to={dashboardPath}
                className="block w-full px-4 py-2 rounded-lg bg-gradient-to-r from-red-800 to-red-700 text-white font-medium text-sm shadow-md hover:shadow-lg transition-all duration-300 text-center"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <FaTachometerAlt className="inline mr-1.5" />
                Dashboard
              </Link>

              <button
                onClick={() => {
                  handleLogout();
                  setIsMobileMenuOpen(false);
                }}
                className="block w-full px-4 py-2 rounded-lg border-2 border-red-600 text-red-300 font-medium text-sm transition-all duration-300 hover:border-transparent hover:bg-red-600 hover:text-white hover:shadow-lg text-center"
              >
                <FaSignOutAlt className="inline mr-1.5" />
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                to="/login"
                className="block w-full px-4 py-2 rounded-lg bg-gradient-to-r from-red-800 to-red-700 text-white font-medium text-sm shadow-md hover:shadow-lg transition-all duration-300 text-center"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <FaSignInAlt className="inline mr-1.5" />
                Login
              </Link>

              <Link
                to="/register"
                className="block w-full px-4 py-2 rounded-lg border-2 border-gray-600 text-gray-300 font-medium text-sm transition-all duration-300 hover:border-transparent hover:bg-gradient-to-r hover:from-red-800 hover:to-red-700 hover:text-white hover:shadow-lg text-center"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <FaUserPlus className="inline mr-1.5" />
                Register
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;