import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { FaUser, FaLock, FaEnvelope, FaEye, FaEyeSlash, FaGraduationCap, FaUserPlus, FaPhone, FaIdCard, FaSchool, FaChevronDown } from "react-icons/fa";
import { authAPI, scholarshipAPI } from "../../../services/api";

const Register = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    studentId: "",
    school: "",
    role: "",
    password: "",
    confirmPassword: "",
    showPassword: false,
    showConfirmPassword: false,
    isLoading: false,
    error: "",
    agreement: false
  });
  const [providers, setProviders] = useState([]);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await scholarshipAPI.getProviders();
        setProviders(response.data);
      } catch (err) {
        console.error("Failed to fetch providers:", err);
      } finally {
        setIsLoadingProviders(false);
      }
    };
    fetchProviders();
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === "checkbox" ? checked : value,
      error: ""
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormData({ ...formData, isLoading: true, error: "" });

    // Basic validation
    if (!formData.role) {
      setFormData({
        ...formData,
        error: "Please enter a scholarship program",
        isLoading: false
      });
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setFormData({
        ...formData,
        error: "Passwords do not match",
        isLoading: false
      });
      return;
    }

    if (!formData.agreement) {
      setFormData({
        ...formData,
        error: "Please agree to the terms and conditions",
        isLoading: false
      });
      return;
    }

    try {
      // Check if email already exists
      const checkResponse = await authAPI.checkEmail(formData.email);
      if (checkResponse.data.exists) {
        setFormData({
          ...formData,
          error: "This email is already registered. Please use another or sign in.",
          isLoading: false
        });
        return;
      }

      // Call backend API for registration
      const response = await authAPI.register(
        `${formData.firstName} ${formData.lastName}`,
        formData.email,
        formData.email.split('@')[0], // Use email prefix as username
        formData.password,
        formData.role
      );

      // Store user data in localStorage
      localStorage.setItem('userName', `${formData.firstName} ${formData.lastName}`);
      localStorage.setItem('userFirstName', formData.firstName);
      localStorage.setItem('userLastName', formData.lastName);

      alert("Registration successful! Please check your email for verification.");
      
      // Redirect to login
      navigate('/login');
    } catch (error) {
      setFormData({
        ...formData,
        error: error.response?.data?.message || "Registration failed. Please try again.",
        isLoading: false
      });
    }
  };

  const togglePassword = (field) => {
    setFormData({
      ...formData,
      [field]: !formData[field]
    });
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
      <div className="w-full max-w-4xl relative z-10">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl shadow-2xl border border-white/30 overflow-hidden">
          <div className="flex flex-col lg:flex-row">

            {/* Left Side - Header */}
            <div className="bg-gradient-to-r from-red-800 to-red-700 p-6 lg:p-8 text-center lg:text-left lg:w-2/5">
              <div className="w-12 h-12 sm:w-14 sm:h-14 lg:w-16 lg:h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-4">
                <FaGraduationCap className="text-2xl sm:text-3xl lg:text-4xl text-white" />
              </div>

              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white mb-3">
                Create Account
              </h1>
              <p className="text-white/90 text-sm sm:text-base">
                Join Iskomats Scholarship Program
              </p>
            </div>

            {/* Right Side - Form */}
            <div className="p-4 sm:p-6 lg:p-8 lg:w-3/5">
              {formData.error && (
                <div className="bg-red-600 text-white p-3 rounded-xl mb-5 text-sm text-center">
                  {formData.error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">

                {/* Name Fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-white text-sm font-semibold">
                      First Name
                    </label>
                    <div className="relative mt-2">
                      <FaUser className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                      <input
                        type="text"
                        name="firstName"
                        value={formData.firstName}
                        onChange={handleChange}
                        placeholder="Enter your first name"
                        required
                        className="w-full pl-9 pr-3 py-1.5 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-white text-sm font-semibold">
                      Last Name
                    </label>
                    <div className="relative mt-2">
                      <FaUser className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                      <input
                        type="text"
                        name="lastName"
                        value={formData.lastName}
                        onChange={handleChange}
                        placeholder="Enter your last name"
                        required
                        className="w-full pl-9 pr-3 py-1.5 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white"
                      />
                    </div>
                  </div>
                </div>

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
                      placeholder="Enter your email"
                      required
                      className="w-full pl-9 pr-3 py-1.5 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white"
                    />
                  </div>
                </div>

                {/* Scholarship Input */}
                <div>
                  <label className="text-white text-sm font-semibold">
                    What role scholarship are you?
                  </label>
                  <div className="mt-2 relative">
                    <select
                      name="role"
                      value={formData.role}
                      onChange={handleChange}
                      required
                      className="w-full px-3 py-1.5 rounded-md bg-white/10 border border-white/30 text-white focus:outline-none focus:border-white appearance-none"
                    >
                      <option value="" disabled className="bg-red-900 text-white">Select scholarship role</option>
                      {providers.map((p) => (
                        <option key={p.pro_no} value={p.provider_name} className="bg-red-900 text-white">
                          {p.provider_name}
                        </option>
                      ))}
                    </select>
                    <FaChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-red-300 pointer-events-none text-xs" />
                  </div>
                </div>

                {/* Password Field */}
                <div>
                  <label className="text-white text-sm font-semibold">
                    Password
                  </label>
                  <div className="relative mt-2">
                    <FaLock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                    <input
                      type={formData.showPassword ? "text" : "password"}
                      name="password"
                      value={formData.password}
                      onChange={handleChange}
                      placeholder="Enter your password"
                      required
                      className="w-full pl-9 pr-10 py-1.5 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white"
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
                    Confirm Password
                  </label>
                  <div className="relative mt-2">
                    <FaLock className="absolute left-2.5 top-1/2 -translate-y-1/2 text-red-300" />
                    <input
                      type={formData.showConfirmPassword ? "text" : "password"}
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      placeholder="Confirm your password"
                      required
                      className="w-full pl-9 pr-10 py-1.5 rounded-md bg-white/10 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:border-white"
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

                <label className="flex items-start gap-3 text-sm text-white/90">
                  <input
                    type="checkbox"
                    name="agreement"
                    checked={formData.agreement}
                    onChange={handleChange}
                    className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 text-red-600 focus:ring-red-400"
                  />
                  <span>
                    I agree to the terms and conditions of the Iskomats Scholarship Program.
                  </span>
                </label>
                
                {/* Button */}
                <button
                  type="submit"
                  disabled={formData.isLoading}
                  className="w-full py-1.5 rounded-md bg-gradient-to-r from-red-800 to-red-700 text-white font-bold flex items-center justify-center gap-2 hover:-translate-y-0.5 transition disabled:opacity-60"
                >
                  {formData.isLoading ? (
                    <>
                      <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Creating Account...
                    </>
                  ) : (
                    <>
                      <FaUserPlus />
                      Create Account
                    </>
                  )}
                </button>
              </form>

              {/* Footer */}
              <div className="pt-6 text-center border-t border-white/20 mt-6 text-sm text-white/80">
                <p>
                  Already have an account?{" "}
                  <a href="/login" className="font-bold hover:underline">
                    Sign in
                  </a>
                </p>
                <p className="text-xs text-white/60 mt-2">
                  2025 Iskomats Scholarships
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Register;