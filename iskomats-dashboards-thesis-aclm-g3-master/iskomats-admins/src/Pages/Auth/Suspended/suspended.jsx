import { useNavigate } from 'react-router-dom';
import { FaBan, FaArrowLeft } from 'react-icons/fa';
import authBg from '../../../assets/ad1.jpg';
import logo from '../../../assets/logo.png';

export default function Suspended() {
  const navigate = useNavigate();

  const handleReturnToLogin = () => {
    localStorage.removeItem('accountSuspended');
    localStorage.removeItem('authToken');
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('userFirstName');
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 relative overflow-hidden bg-black">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${authBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/70 via-black/60 to-black/85" />

      <div className="w-full max-w-2xl relative z-10">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="p-8 sm:p-10 text-center">
            <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white/10 backdrop-blur-md rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 p-2">
              <img src={logo} alt="Iskomats Logo" className="w-full h-full object-contain" />
            </div>

            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-600/90 flex items-center justify-center text-white text-2xl mb-6">
              <FaBan />
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-white mb-4">Account Suspended</h1>
            <p className="text-white/85 text-base sm:text-lg leading-relaxed max-w-xl mx-auto">
              Your admin account has been suspended. You cannot access the system while this status is active.
              Please contact the super administrator for assistance.
            </p>

            <button
              type="button"
              onClick={handleReturnToLogin}
              className="mt-8 inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-white text-[#800020] font-bold hover:-translate-y-0.5 transition shadow-lg"
            >
              <FaArrowLeft />
              Return To Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}