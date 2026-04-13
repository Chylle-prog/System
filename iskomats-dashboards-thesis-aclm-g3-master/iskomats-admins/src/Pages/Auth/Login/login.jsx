import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  FaLock,
  FaEnvelope,
  FaEye,
  FaEyeSlash,
  FaSignInAlt,
} from "react-icons/fa";
import { authAPI } from "../../../services/api";
import { PROVIDER_DASHBOARD_ROUTE, isProviderDashboardRole } from "../../Dash/provider-dashboard-config";
import authBg from "../../../assets/lipa.jpg";
import logo from "../../../assets/logo.png";

const Login = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    showPassword: false,
    isLoading: false,
    error: "",
  });

  useEffect(() => {
    const sessionExpired = localStorage.getItem('session_expired');
    if (sessionExpired === 'true') {
      setFormData(prev => ({ ...prev, error: "Your session has expired. Please log in again." }));
      localStorage.removeItem('session_expired');
    }

    if (localStorage.getItem('accountSuspended') === 'true') {
      navigate('/suspended', { replace: true });
    }
  }, []);

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
      error: "",
    });
  };

  const togglePassword = () => {
    setFormData({ ...formData, showPassword: !formData.showPassword });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "" });

    try {
      // Show loading spinner during slow login
      const response = await authAPI.login(formData.email, formData.password);
      localStorage.removeItem('accountSuspended');
      // ...existing code...
      localStorage.setItem('authToken', response.data.token);
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('userRole', response.data.userRole);
      localStorage.setItem('userEmail', formData.email);
      localStorage.setItem('userName', response.data.userName);
      localStorage.setItem('userFirstName', response.data.userFirstName);
      // ...existing code...
      const role = response.data.userRole;
      switch (role) {
        case 'admin':
        case 'main':
          navigate('/dash');
          break;
        default:
          if (isProviderDashboardRole(role)) {
            navigate(PROVIDER_DASHBOARD_ROUTE);
            break;
          }
          navigate('/dash');
          break;
      }

    } catch (error) {
      let errorMessage = "Login failed. Please check if your email exists, the role is correct, and the password is correct.";
      if (error.response) {
        if (error.response.status === 404) {
          errorMessage = "Email doesn't exist.";
        } else if (error.response.status === 403) {
          if (error.response.data?.suspended) {
            localStorage.setItem('accountSuspended', 'true');
            navigate('/suspended', { replace: true });
            return;
          }
          // Check if it's an email verification error
          if (error.response.data?.message?.includes('not verified') || 
              error.response.data?.message?.includes('verify')) {
            errorMessage = "Please verify your email first. Redirecting to verification page...";
            localStorage.setItem('registrationEmail', formData.email);
            setFormData({
              ...formData,
              error: errorMessage,
              isLoading: false,
            });
            setTimeout(() => {
              navigate('/verify-email');
            }, 2000);
            return;
          }
          errorMessage = error.response.data?.message || "The role is wrong or the password is incorrect.";
        } else if (error.response.status === 401) {
          errorMessage = error.response.data?.message || "The role is wrong or the password is incorrect.";
        } else if (error.response.data && error.response.data.message) {
          errorMessage = error.response.data.message;
        }
      }
      setFormData({
        ...formData,
        error: errorMessage,
        isLoading: false,
      });
    }
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
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />

      <div className="w-full max-w-4xl relative z-10">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="flex flex-col lg:flex-row">

            <div className="bg-gradient-to-r from-[#800020] to-[#650018] p-6 lg:p-7 text-center lg:w-2/5 flex flex-col justify-center items-center border-r border-white/10">
              <div className="w-20 h-20 sm:w-24 sm:h-24 bg-white/10 backdrop-blur-md rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 p-2">
                <img src={logo} alt="Iskomats Logo" className="w-full h-full object-contain" />
              </div>

              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-3">
                Welcome Back
              </h1>
              <p className="text-white/90 text-sm sm:text-base">
                Sign in to your account
              </p>
            </div>

            <div className="p-4 sm:p-6 lg:p-8 lg:w-3/5">
              {formData.error && (
                <div className="bg-red-600 text-white p-4 rounded-xl mb-6 text-sm text-center">
                  {formData.error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="text-white text-sm font-semibold">
                    return (
                      <div className="login-container" style={{ backgroundImage: `url(${authBg})` }}>
                        <form className="login-form" onSubmit={handleSubmit}>
                          <img src={logo} alt="Logo" className="login-logo" />
                          <h2>Admin Login</h2>
                          {formData.error && <div className="error-message">{formData.error}</div>}
                          <div className="input-group">
                            <FaEnvelope className="input-icon" />
                            <input
                              type="email"
                              name="email"
                              placeholder="Email"
                              value={formData.email}
                              onChange={handleChange}
                              required
                            />
                          </div>
                          <div className="input-group">
                            <FaLock className="input-icon" />
                            <input
                              type={formData.showPassword ? "text" : "password"}
                              name="password"
                              placeholder="Password"
                              value={formData.password}
                              onChange={handleChange}
                              required
                            />
                            <span className="toggle-password" onClick={togglePassword}>
                              {formData.showPassword ? <FaEyeSlash /> : <FaEye />}
                            </span>
                          </div>
                          <button type="submit" className="login-btn" disabled={formData.isLoading}>
                            {formData.isLoading ? <span className="fa-spin"><FaSignInAlt /></span> : <FaSignInAlt />} Sign In
                          </button>
                          {formData.isLoading && <div className="loading-message">Signing in, please wait...</div>}
                        </form>
                      </div>
                    );
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:justify-between gap-4 text-sm text-white/80">
                  <a href="/forget-password" className="hover:underline hover:text-white transition-colors">
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={formData.isLoading}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-[#800020] to-[#650018] text-white font-bold flex items-center justify-center gap-3 hover:-translate-y-1 transition disabled:opacity-60 shadow-lg shadow-black/20"
                >
                  {formData.isLoading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Signing in...
                    </>
                  ) : (
                    <>
                      <FaSignInAlt />
                      Sign In
                    </>
                  )}
                </button>
              </form>

              <div className="pt-6 text-center border-t border-white/20 mt-6 text-sm text-white/80">
                <p>
                  Don't have an account?{" "}
                  <a href="/register" className="font-bold hover:underline">
                    Create account
                  </a>
                </p>
                <p className="text-xs text-white/60 mt-2">
                  &copy; 2025 Iskomats Scholarships
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
