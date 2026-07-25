import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaEnvelope, FaPaperPlane, FaCheckCircle } from "react-icons/fa";
import { authAPI } from '../../../services/api';
import authBg from "../../../assets/lipa.jpg";
import logo from "../../../assets/logo.png";

const ForgetPass = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    email: "",
    isLoading: false,
    error: "",
    success: false,
    isSubmitted: false
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
      error: "",
      success: false
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "", success: false });

    // Basic validation
    if (!formData.email) {
      setFormData({
        ...formData,
        error: "Email is required",
        isLoading: false
      });
      return;
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setFormData({
        ...formData,
        error: "Please enter a valid email address",
        isLoading: false
      });
      return;
    }

    try {
      // Call forgotPassword directly - backend handles email validation gracefully
      const response = await authAPI.forgotPassword(formData.email.trim());
      console.log('Forgot Password Response:', response);
      
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: true,
        isSubmitted: true,
        error: "",
      }));
    } catch (error) {
      console.error('Forgot Password Error:', error);
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to send reset email',
      }));
    }
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const handleResendEmail = () => {
    handleSubmit({ preventDefault: () => {} });
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

      <div className="relative w-[92%] max-w-xs sm:max-w-sm md:max-w-md z-10 my-auto transition-all duration-300">
        <div className="bg-white/10 backdrop-blur-2xl rounded-2xl sm:rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="flex flex-col">
            <div className="bg-gradient-to-r from-[#800020] to-[#650018] p-3.5 sm:p-5 lg:p-7 flex flex-row sm:flex-col items-center justify-center gap-3 sm:gap-0 text-left sm:text-center border-b border-white/10">
              <div className="w-10 h-10 sm:w-16 sm:h-16 lg:w-20 lg:h-20 bg-white/10 backdrop-blur-md rounded-xl sm:rounded-2xl flex items-center justify-center p-1.5 sm:p-2 shadow-lg border border-white/20 shrink-0 sm:mb-3 sm:mx-auto transition-all">
                <img src={logo} alt="Iskomats Logo" className="w-full h-full object-contain" />
              </div>
              <div>
                <h1 className="text-base sm:text-xl lg:text-2xl font-bold text-white mb-0.5 sm:mb-1">
                  Forgot Password?
                </h1>
                <p className="text-white/80 text-[11px] sm:text-xs max-w-sm">
                  {formData.isSubmitted
                    ? "Check your email for reset instructions"
                    : "Enter your email address and we'll send you a link to reset your password"
                  }
                </p>
              </div>
            </div>

            <div className="p-3.5 sm:p-5 lg:p-6">
              {!formData.isSubmitted ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="text-white text-xs font-semibold">
                      Email Address
                    </label>
                    <div className="relative mt-1.5">
                      <FaEnvelope className="absolute left-3.5 top-1/2 -translate-y-1/2 text-red-300 text-xs" />
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="Enter your registered email"
                        required
                        disabled={formData.isLoading}
                        className="w-full pl-9 sm:pl-10 pr-3.5 py-2 sm:py-2.5 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/50 text-xs focus:outline-none focus:border-white disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {formData.error && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-2.5">
                      <p className="text-red-200 text-xs">{formData.error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={formData.isLoading}
                    className="w-full py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-[#800020] to-[#650018] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:-translate-y-0.5 transition disabled:opacity-60 shadow-md shadow-black/20"
                  >
                    {formData.isLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                        Sending Reset Link...
                      </>
                    ) : (
                      <>
                        <FaPaperPlane />
                        Send Reset Link
                      </>
                    )}
                  </button>
                </form>
              ) : (
                <div className="text-center space-y-4">
                  <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 bg-green-500/20 rounded-full">
                    <FaCheckCircle className="text-xl sm:text-2xl text-green-300" />
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-white">
                      Reset Link Sent!
                    </h3>
                    <p className="text-white/70 text-xs">
                      We've sent a password reset link to:
                    </p>
                    <div className="bg-white/10 rounded-lg p-2 sm:p-2.5 border border-white/20">
                      <p className="text-white text-xs font-medium">{formData.email}</p>
                    </div>
                    <p className="text-white/60 text-[11px] text-center">
                      Please check your email and follow the instructions to reset your password.
                      If you don't receive the email within a few minutes, please check your spam folder.
                    </p>
                  </div>

                  {formData.success && (
                    <div className="bg-green-500/20 border border-green-500/50 rounded-lg p-2.5">
                      <p className="text-green-200 text-xs">Reset email sent successfully!</p>
                    </div>
                  )}

                  <button
                    onClick={handleResendEmail}
                    disabled={formData.isLoading}
                    className="w-full py-2 sm:py-2.5 rounded-xl bg-white/10 border border-white/30 text-white text-xs font-bold hover:bg-white/20 transition disabled:opacity-60 shadow-sm"
                  >
                    {formData.isLoading ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2"></span>
                        Resending...
                      </>
                    ) : (
                      "Resend Email"
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="p-3.5 sm:p-4 text-center border-t border-white/20 text-xs text-white/80">
              <p>
                Remember your password?{" "}
                <button
                  onClick={handleBackToLogin}
                  className="font-bold hover:underline text-[#ff6b81]"
                >
                  Sign In
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgetPass;