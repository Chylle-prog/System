import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaEnvelope, FaArrowLeft, FaPaperPlane, FaCheckCircle, FaSignInAlt } from "react-icons/fa";

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

    // Simulate API call
    setTimeout(() => {
      // Simulate successful password reset request
      setFormData({
        ...formData,
        isLoading: false,
        success: true,
        isSubmitted: true
      });
    }, 2000);
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const handleResendEmail = () => {
    setFormData({ ...formData, isLoading: true, success: false });
    
    // Simulate resending email
    setTimeout(() => {
      setFormData({
        ...formData,
        isLoading: false,
        success: true
      });
    }, 1000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6 pt-20 bg-gradient-to-br from-red-900 via-red-800 to-red-950 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Card */}
      <div className="relative w-full max-w-md">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-2xl p-8 border border-white/20">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500/20 rounded-full mb-4">
              <FaEnvelope className="text-2xl text-red-300" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Forgot Password?
            </h1>
            <p className="text-white/70 text-sm">
              {formData.isSubmitted 
                ? "Check your email for reset instructions"
                : "Enter your email address and we'll send you a link to reset your password"
              }
            </p>
          </div>

          {!formData.isSubmitted ? (
            <>
              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Email Field */}
                <div>
                  <label className="text-white text-sm font-semibold">
                    Email Address
                  </label>
                  <div className="relative mt-2">
                    <FaEnvelope className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="Enter your registered email"
                      required
                      disabled={formData.isLoading}
                      className="w-full pl-9 pr-3 py-2 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white disabled:opacity-60"
                    />
                  </div>
                </div>

                {/* Error Message */}
                {formData.error && (
                  <div className="bg-red-500/20 border border-red-500/50 rounded-md p-3">
                    <p className="text-red-200 text-sm">{formData.error}</p>
                  </div>
                )}

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={formData.isLoading}
                  className="w-full py-2 rounded-md bg-gradient-to-r from-red-800 to-red-700 text-white font-bold flex items-center justify-center gap-2 hover:-translate-y-0.5 transition disabled:opacity-60"
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
            </>
          ) : (
            <>
              {/* Success Message */}
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
                  <p className="text-white/60 text-xs">
                    Please check your email and follow the instructions to reset your password. 
                    If you don't receive the email within a few minutes, please check your spam folder.
                  </p>
                </div>

                {/* Success Message */}
                {formData.success && (
                  <div className="bg-green-500/20 border border-green-500/50 rounded-md p-3">
                    <p className="text-green-200 text-sm">Reset email sent successfully!</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-3">
                  <button
                    onClick={handleResendEmail}
                    disabled={formData.isLoading}
                    className="w-full py-2 rounded-md bg-white/10 border border-white/30 text-white font-medium hover:bg-white/20 transition disabled:opacity-60"
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
              </div>
            </>
          )}

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-white/60 text-xs">
              Remember your password?{" "}
              <button
                onClick={handleBackToLogin}
                className="text-red-300 hover:text-white transition-colors"
              >
                Sign In
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgetPass;