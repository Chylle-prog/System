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

      <div className="relative w-full max-w-md z-10">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="flex flex-col">
            <div className="bg-gradient-to-r from-[#800020] to-[#650018] p-7 lg:p-9 text-center flex flex-col justify-center items-center border-b border-white/10">
              <div className="w-20 h-20 sm:w-24 sm:h-24 lg:w-28 lg:h-28 bg-white/10 backdrop-blur-md rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl border border-white/20 p-2">
                <img src={logo} alt="Iskomats Logo" className="w-full h-full object-contain" />
              </div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-2">
                Forgot Password?
              </h1>
              <p className="text-white/80 text-sm max-w-sm">
                {formData.isSubmitted
                  ? "Check your email for reset instructions"
                  : "Enter your email address and we'll send you a link to reset your password"
                }
              </p>
            </div>

            <div className="p-6 sm:p-8">
              {!formData.isSubmitted ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="text-white text-sm font-semibold">
                      Email Address
                    </label>
                    <div className="relative mt-2">
                      <FaEnvelope className="absolute left-4 top-1/2 -translate-y-1/2 text-red-300" />
                      <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="Enter your registered email"
                        required
                        disabled={formData.isLoading}
                        className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white disabled:opacity-60"
                      />
                    </div>
                  </div>

                  {formData.error && (
                    <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3">
                      <p className="text-red-200 text-sm">{formData.error}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={formData.isLoading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-[#800020] to-[#650018] text-white font-bold flex items-center justify-center gap-3 hover:-translate-y-1 transition disabled:opacity-60 shadow-lg shadow-black/20"
                  >
                    {formData.isLoading ? (
                      <>
                        <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
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
                <div className="text-center space-y-6">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full">
                    <FaCheckCircle className="text-2xl text-green-300" />
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xl font-semibold text-white">
                      Reset Link Sent!
                    </h3>
                    <p className="text-white/70 text-sm">
                      We've sent a password reset link to:
                    </p>
                    <div className="bg-white/10 rounded-md p-3 border border-white/20">
                      <p className="text-white font-medium">{formData.email}</p>
                    </div>
                    <p className="text-white/60 text-xs text-center">
                      Please check your email and follow the instructions to reset your password.
                      If you don't receive the email within a few minutes, please check your spam folder.
                    </p>
                  </div>

                  {formData.success && (
                    <div className="bg-green-500/20 border border-green-500/50 rounded-md p-3">
                      <p className="text-green-200 text-sm">Reset email sent successfully!</p>
                    </div>
                  )}

                  <button
                    onClick={handleResendEmail}
                    disabled={formData.isLoading}
                    className="w-full py-3 rounded-xl bg-white/10 border border-white/30 text-white font-bold hover:bg-white/20 transition disabled:opacity-60 shadow-sm"
                  >
                    {formData.isLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-2"></span>
                        Resending...
                      </>
                    ) : (
                      "Resend Email"
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 text-center border-t border-white/20 text-sm text-white/80">
              <p>
                Remember your password?{" "}
                <button
                  onClick={handleBackToLogin}
                  className="font-bold hover:underline"
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