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

  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    clearAdminSession();
    window.location.href = '/login';
  };

  return (
    <>
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

    {/* Logout Confirmation Modal */}
    {showLogoutConfirm && (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-gray-900 border border-gray-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
          <div className="w-16 h-16 bg-red-900/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <FaSignOutAlt className="text-3xl text-red-500" />
          </div>
          
          <h3 className="text-xl font-bold text-white text-center mb-2">Logout Confirmation</h3>
          <p className="text-gray-400 text-center mb-8">Are you sure you want to end your session? You will need to login again to access the dashboard.</p>
          
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setShowLogoutConfirm(false)}
              className="px-6 py-3 rounded-xl border border-gray-700 text-gray-300 font-semibold transition-all hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={confirmLogout}
              className="px-6 py-3 rounded-xl bg-red-600 text-white font-semibold transition-all hover:bg-red-700 hover:shadow-lg hover:shadow-red-600/20"
            >
              Logout
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Navbar;