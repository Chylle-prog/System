import { useNavigate } from 'react-router-dom';
import { FaLock, FaArrowLeft } from 'react-icons/fa';

const AccessDenied = ({ message }) => {
  const navigate = useNavigate();

  const handleGoBack = () => {
    const userRole = localStorage.getItem('userRole');
    switch (userRole) {
      case 'africa':
        navigate('/dash-africa');
        break;
      case 'vilma':
        navigate('/dash-vilma');
        break;
      case 'tulong':
        navigate('/dash-tulong');
        break;
      default:
        navigate('/dash');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-blue-50/30">
      <div className="max-w-md w-full mx-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <FaLock className="text-2xl text-red-600" />
          </div>

          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Access Denied
          </h1>

          <p className="text-gray-600 mb-8">
            {message || "You don't have permission to access this dashboard."}
          </p>

          <button
            onClick={handleGoBack}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-800 to-red-700 text-white font-semibold rounded-xl hover:-translate-y-1 transition-all duration-300 shadow-lg"
          >
            <FaArrowLeft />
            Go to Your Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccessDenied;
