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
      const userId = response.data.userId || response.data.user_id || response.data.user_no || response.data.userNo;
      if (userId) {
        localStorage.setItem('userId', String(userId));
      }
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
    <div className="min-h-screen flex items-center justify-center p-2.5 sm:p-4 lg:p-8 relative overflow-y-auto bg-black">
      <div
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url(${authBg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-black/75 via-black/55 to-black/85" />

      <div className="w-[92%] max-w-xs sm:max-w-md md:max-w-lg lg:max-w-3xl xl:max-w-4xl relative z-10 my-auto transition-all duration-300">
        <div className="bg-white/10 backdrop-blur-2xl rounded-2xl sm:rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="flex flex-col lg:flex-row">

            {/* Left Header / Branding Banner with Responsive Picture Adjustment */}
            <div className="bg-gradient-to-r from-[#800020] to-[#650018] p-3.5 sm:p-5 lg:p-8 flex flex-row lg:flex-col items-center justify-center gap-3 lg:gap-0 text-left lg:text-center lg:w-2/5 border-b lg:border-b-0 lg:border-r border-white/10 shrink-0">
              <div className="w-10 h-10 sm:w-14 sm:h-14 lg:w-20 lg:h-20 xl:w-24 xl:h-24 bg-white/10 backdrop-blur-md rounded-xl sm:rounded-2xl lg:rounded-3xl flex items-center justify-center p-1.5 sm:p-2 shadow-lg border border-white/20 shrink-0 lg:mb-4 lg:mx-auto transition-all">
                <img src={logo} alt="Iskomats Logo" className="w-full h-full object-contain" />
              </div>

              <div>
                <h1 className="text-base sm:text-xl lg:text-2xl xl:text-3xl font-bold text-white mb-0 lg:mb-2">
                  Welcome Back
                </h1>
                <p className="text-white/85 text-[11px] sm:text-xs lg:text-sm">
                  Sign in to your account
                </p>
              </div>
            </div>

            {/* Form Section Tightly Scaled to Content */}
            <div className="p-3.5 sm:p-5 lg:p-7 lg:w-3/5">
              {formData.error && (
                <div className={`text-white p-2.5 sm:p-3 rounded-xl mb-3 sm:mb-4 text-xs text-center ${formData.error.includes('Setup complete') ? 'bg-green-600' : 'bg-red-600'}`}>
                  {formData.error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3 sm:space-y-4">
                <div className="space-y-2.5 sm:space-y-3.5">
                  <div className="form-group">
                    <label className="block text-white text-xs font-semibold mb-1 sm:mb-1.5">Email Address</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 sm:pl-3.5 flex items-center pointer-events-none text-white/40 group-focus-within:text-white transition-colors text-xs">
                        <FaEnvelope />
                      </div>
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        className="w-full bg-white/5 border border-white/20 rounded-xl py-2 sm:py-2.5 pl-9 sm:pl-10 pr-3.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#800020]/50 focus:border-[#800020] transition-all"
                        placeholder="admin@iskomats.ph"
                        required
                      />
                    </div>
                  </div>

                  <div className="form-group">
                    <div className="flex justify-between items-center mb-1 sm:mb-1.5">
                      <label className="text-white text-xs font-semibold">Password</label>
                    </div>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 sm:pl-3.5 flex items-center pointer-events-none text-white/40 group-focus-within:text-white transition-colors text-xs">
                        <FaLock />
                      </div>
                      <input
                        type={formData.showPassword ? "text" : "password"}
                        name="password"
                        value={formData.password}
                        onChange={handleChange}
                        className="w-full bg-white/5 border border-white/20 rounded-xl py-2 sm:py-2.5 pl-9 sm:pl-10 pr-9 sm:pr-10 text-xs text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-[#800020]/50 focus:border-[#800020] transition-all"
                        placeholder="•••••••••••"
                        required
                      />
                      <button
                        type="button"
                        onClick={togglePassword}
                        className="absolute inset-y-0 right-0 pr-3 sm:pr-3.5 flex items-center text-white/40 hover:text-white transition-colors text-xs"
                      >
                        {formData.showPassword ? <FaEyeSlash /> : <FaEye />}
                      </button>
                    </div>
                    <div className="mt-1 text-right">
                      <a href="/forget-password" onClick={(e) => { e.preventDefault(); navigate('/forget-password'); }} className="text-[11px] text-white/60 hover:text-white hover:underline transition-colors">
                        Forgot password?
                      </a>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={formData.isLoading}
                  className="w-full py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-[#800020] to-[#650018] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:-translate-y-0.5 transition disabled:opacity-60 shadow-md shadow-black/20"
                >
                  {formData.isLoading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
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



              <div className="pt-3 sm:pt-4 text-center mt-1 text-xs text-white/80">
                <p className="text-[10px] sm:text-xs text-white/60">
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


