import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FaEnvelope, FaCheckCircle, FaExclamationCircle } from "react-icons/fa";
import { authAPI } from "../../../services/api";

const VerifyEmail = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [formData, setFormData] = useState({
    verificationCode: "",
    error: "",
    success: false,
    isLoading: false,
  });
  const [email, setEmail] = useState("");
  const [verificationState, setVerificationState] = useState("input"); // input, loading, success, error, auto-verifying

  useEffect(() => {
    // Check if there's an email in localStorage (from registration)
    const registrationEmail = localStorage.getItem('registrationEmail') || localStorage.getItem('userEmail');
    if (registrationEmail) {
      setEmail(registrationEmail);
    }

    // Check if there's a token in the URL (from email link)
    const token = searchParams.get('token');
    if (token) {
      setVerificationState("auto-verifying");
      handleAutoVerification(token);
    }
  }, [searchParams]);

  const handleAutoVerification = async (token) => {
    try {
      await authAPI.verifyEmail(token);
      setVerificationState("success");
      setFormData({ ...formData, success: true });
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        localStorage.removeItem('registrationEmail');
        localStorage.removeItem('registrationPassword');
        navigate('/login');
      }, 2000);
    } catch (error) {
      setVerificationState("error");
      setFormData({
        ...formData,
        error: error.response?.data?.message || "Verification link is invalid or expired. Please try again.",
      });
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      verificationCode: e.target.value.toUpperCase(),
      error: "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.verificationCode.trim()) {
      setFormData({
        ...formData,
        error: "Please enter the verification code",
      });
      return;
    }

    setFormData({ ...formData, isLoading: true, error: "" });
    setVerificationState("loading");

    try {
      await authAPI.verifyEmail(formData.verificationCode);
      setVerificationState("success");
      setFormData({ ...formData, success: true, isLoading: false });
      
      // Redirect to login after 2 seconds
      setTimeout(() => {
        localStorage.removeItem('registrationEmail');
        localStorage.removeItem('registrationPassword');
        navigate('/login');
      }, 2000);
    } catch (error) {
      setVerificationState("error");
      setFormData({
        ...formData,
        error: error.response?.data?.message || "Invalid verification code. Please try again.",
        isLoading: false,
      });
    }
  };

  const handleBackToLogin = () => {
    localStorage.removeItem('registrationEmail');
    localStorage.removeItem('registrationPassword');
    navigate('/login');
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
      <div className="w-full max-w-md relative z-10">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          
          {/* Header */}
          <div className="bg-gradient-to-r from-red-800 to-red-700 p-8 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              {verificationState === "success" ? (
                <FaCheckCircle className="text-4xl text-green-400" />
              ) : verificationState === "error" ? (
                <FaExclamationCircle className="text-4xl text-yellow-400" />
              ) : (
                <FaEnvelope className="text-4xl text-white" />
              )}
            </div>

            <h1 className="text-3xl font-bold text-white mb-2">
              {verificationState === "success" ? "Email Verified!" : "Verify Your Email"}
            </h1>
            <p className="text-white/90 text-sm">
              {verificationState === "success" 
                ? "Your email has been verified successfully."
                : "Enter the verification code sent to your email"}
            </p>
          </div>

          {/* Content */}
          <div className="p-8">
            {verificationState === "auto-verifying" && (
              <div className="text-center text-white">
                <div className="animate-spin h-8 w-8 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4"></div>
                <p>Verifying your email...</p>
              </div>
            )}

            {verificationState === "success" && (
              <div className="text-center">
                <p className="text-white/90 mb-6">
                  You will be redirected to login in a few seconds...
                </p>
                <button
                  onClick={handleBackToLogin}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-green-600 to-green-700 text-white font-bold hover:-translate-y-1 transition"
                >
                  Go to Login
                </button>
              </div>
            )}

            {(verificationState === "input" || verificationState === "error") && (
              <>
                {formData.error && (
                  <div className="bg-red-600 text-white p-4 rounded-xl mb-6 text-sm flex items-center gap-2">
                    <FaExclamationCircle />
                    {formData.error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <label className="text-white text-sm font-semibold block mb-2">
                      Verification Code
                    </label>
                    <input
                      type="text"
                      value={formData.verificationCode}
                      onChange={handleChange}
                      placeholder="Enter 6-digit code or token"
                      maxLength="50"
                      required
                      className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white text-center text-lg tracking-widest"
                    />
                    <p className="text-white/60 text-xs mt-2">
                      Check your email for the verification code
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={formData.isLoading}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-red-800 to-red-700 text-white font-bold hover:-translate-y-1 transition disabled:opacity-60"
                  >
                    {formData.isLoading ? "Verifying..." : "Verify Email"}
                  </button>
                </form>

                <div className="mt-6 text-center">
                  <button
                    onClick={handleBackToLogin}
                    className="text-white/70 hover:text-white text-sm transition"
                  >
                    Back to Login
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmail;