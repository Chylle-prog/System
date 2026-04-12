import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FaLock, FaEye, FaEyeSlash, FaCheckCircle, FaArrowLeft, FaShieldAlt } from "react-icons/fa";
import { authAPI } from '../../../services/api';
import authBg from "../../../assets/lipa.jpg";

const ResetPass = () => {
  const navigate = useNavigate();
  const { token: routeToken } = useParams();
  const [formData, setFormData] = useState({
    newPassword: "",
    confirmPassword: "",
    showPassword: false,
    showConfirmPassword: false,
    isLoading: false,
    error: "",
    success: false,
  });
  const token = useMemo(() => routeToken || new URLSearchParams(window.location.search).get('token') || '', [routeToken]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({
      ...formData,
      [name]: value,
      error: "",
      success: false
    });
  };

  const togglePassword = (field) => {
    setFormData({
      ...formData,
      [field]: !formData[field]
    });
  };

  const validatePassword = (password) => {
    // Password validation rules
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return {
      isValid: password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
      errors: {
        length: password.length >= minLength,
        uppercase: hasUpperCase,
        lowercase: hasLowerCase,
        numbers: hasNumbers,
        special: hasSpecialChar
      }
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "", success: false });

    if (!token) {
      setFormData((previous) => ({
        ...previous,
        error: "Password reset link is invalid or missing",
        isLoading: false,
      }));
      return;
    }

    // Basic validation
    if (!formData.newPassword || !formData.confirmPassword) {
      setFormData({
        ...formData,
        error: "All fields are required",
        isLoading: false
      });
      return;
    }

    // Password match validation
    if (formData.newPassword !== formData.confirmPassword) {
      setFormData({
        ...formData,
        error: "Passwords do not match",
        isLoading: false
      });
      return;
    }

    // Password strength validation
    const passwordValidation = validatePassword(formData.newPassword);
    if (!passwordValidation.isValid) {
      setFormData({
        ...formData,
        error: "Password does not meet the requirements",
        isLoading: false
      });
      return;
    }

    try {
      await authAPI.resetPassword(token, formData.newPassword);
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: true,
        error: "",
      }));
    } catch (error) {
      setFormData((previous) => ({
        ...previous,
        isLoading: false,
        success: false,
        error: error.response?.data?.message || error.message || 'Failed to reset password',
      }));
    }
  };

  const handleBackToLogin = () => {
    navigate('/login');
  };

  const passwordValidation = validatePassword(formData.newPassword);

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

      {/* Card */}
      <div className="relative w-full max-w-md">
        {/* Back Button */}
        <button
          onClick={handleBackToLogin}
          className="mb-6 flex items-center gap-2 text-white/80 hover:text-white transition-colors"
        >
          <FaArrowLeft className="text-sm" />
          <span className="text-sm">Back to Login</span>
        </button>

        <div className="bg-white/10 backdrop-blur-md rounded-2xl shadow-2xl p-8 border border-white/20">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500/20 rounded-full mb-4">
              <FaShieldAlt className="text-2xl text-red-300" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Reset Password
            </h1>
            <p className="text-white/70 text-sm">
              {formData.success 
                ? "Password reset successfully!"
                : token ? "Create a new strong password for your account" : "This password reset link is invalid or missing"
              }
            </p>
          </div>

          {!formData.success ? (
            <>
              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* New Password Field */}
                <div>
                  <label className="text-white text-sm font-semibold">
                    New Password
                  </label>
                  <div className="relative mt-2">
                    <FaLock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                    <input
                      type={formData.showPassword ? "text" : "password"}
                      name="newPassword"
                      value={formData.newPassword}
                      onChange={handleChange}
                      placeholder="Enter new password"
                      required
                      disabled={formData.isLoading}
                      className="w-full pl-9 pr-10 py-2 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => togglePassword("showPassword")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-300 hover:text-white"
                    >
                      {formData.showPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password Field */}
                <div>
                  <label className="text-white text-sm font-semibold">
                    Confirm New Password
                  </label>
                  <div className="relative mt-2">
                    <FaLock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                    <input
                      type={formData.showConfirmPassword ? "text" : "password"}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="Confirm new password"
                      required
                      disabled={formData.isLoading}
                      className="w-full pl-9 pr-10 py-2 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => togglePassword("showConfirmPassword")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-red-300 hover:text-white"
                    >
                      {formData.showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                    </button>
                  </div>
                </div>

                {/* Password Requirements */}
                <div className="bg-white/5 rounded-md p-4 border border-white/10">
                  <h4 className="text-white text-sm font-semibold mb-3">Password Requirements:</h4>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordValidation.errors.length ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {passwordValidation.errors.length && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className={`text-xs ${passwordValidation.errors.length ? 'text-green-300' : 'text-gray-400'}`}>
                        At least 8 characters
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordValidation.errors.uppercase ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {passwordValidation.errors.uppercase && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className={`text-xs ${passwordValidation.errors.uppercase ? 'text-green-300' : 'text-gray-400'}`}>
                        One uppercase letter
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordValidation.errors.lowercase ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {passwordValidation.errors.lowercase && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className={`text-xs ${passwordValidation.errors.lowercase ? 'text-green-300' : 'text-gray-400'}`}>
                        One lowercase letter
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordValidation.errors.numbers ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {passwordValidation.errors.numbers && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className={`text-xs ${passwordValidation.errors.numbers ? 'text-green-300' : 'text-gray-400'}`}>
                        One number
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${passwordValidation.errors.special ? 'bg-green-500' : 'bg-gray-500'}`}>
                        {passwordValidation.errors.special && <span className="text-white text-xs">✓</span>}
                      </div>
                      <span className={`text-xs ${passwordValidation.errors.special ? 'text-green-300' : 'text-gray-400'}`}>
                        One special character
                      </span>
                    </div>
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
                  disabled={formData.isLoading || !passwordValidation.isValid || !token}
                  className="w-full py-2 rounded-md bg-gradient-to-r from-red-800 to-red-700 text-white font-bold flex items-center justify-center gap-2 hover:-translate-y-0.5 transition disabled:opacity-60"
                >
                  {formData.isLoading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Resetting Password...
                    </>
                  ) : (
                    <>
                      <FaShieldAlt />
                      Reset Password
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
                    Password Reset Successful!
                  </h3>
                  <p className="text-white/70 text-sm">
                    Your password has been successfully reset. You can now use your new password to sign in to your account.
                  </p>
                  <div className="bg-green-500/20 border border-green-500/50 rounded-md p-3">
                    <p className="text-green-200 text-sm">✓ Password updated successfully</p>
                  </div>
                </div>

                {/* Action Button */}
                <button
                  onClick={handleBackToLogin}
                  className="w-full py-2 rounded-md bg-gradient-to-r from-red-800 to-red-700 text-white font-bold hover:-translate-y-0.5 transition"
                >
                  Continue to Login
                </button>
              </div>
            </>
          )}

          {/* Footer */}
          <div className="mt-8 text-center">
            <p className="text-white/60 text-xs">
              Need help?{" "}
              <button className="text-red-300 hover:text-white transition-colors">
                Contact Support
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPass;