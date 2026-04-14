import React, { createContext, useState, useContext, useEffect } from 'react';
import { getCurrentUser, getUserProfiles, getUserAccounts, setCurrentUser, updateUserProfiles, updateUserAccounts } from '../utils/storage';
import { applicantAPI } from '../services/api';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUserState] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const [userAccounts, setUserAccounts] = useState({});
  const [loading, setLoading] = useState(true);

  // Function to fetch full profile and store first name
  const fetchProfile = async (email) => {
    try {
      const profile = await applicantAPI.getProfile();
      if (profile) {
        setUserProfile(profile);
        if (profile.first_name) {
          localStorage.setItem('userFirstName', profile.first_name);
        }
        return profile;
      }
    } catch (err) {
      console.warn('Could not fetch global profile:', err.message);
    }
    return null;
  };

  useEffect(() => {
    // Load data from localStorage on mount
    const user = getCurrentUser();
    const profiles = getUserProfiles();
    const accounts = getUserAccounts();
    
    setCurrentUserState(user);
    setUserProfiles(profiles);
    setUserAccounts(accounts);
    
    if (user) {
      fetchProfile(user).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    try {
      const response = await require('../services/api').authAPI.login(email, password);
      setCurrentUser(email);
      setCurrentUserState(email);
      localStorage.setItem('currentUser', email);
      localStorage.setItem('authToken', response.token);
      localStorage.setItem('applicantNo', response.applicant_no || '');
      // Store profile data from backend response
      const profile = {
        first_name: response.first_name,
        last_name: response.last_name,
        middle_name: response.middle_name,
        profile_picture: response.profile_picture,
        email: response.email,
        applicant_no: response.applicant_no
      };
      setUserProfile(profile);
      if (profile.first_name) {
        localStorage.setItem('userFirstName', profile.first_name);
      }
      return { success: true, user: email };
    } catch (err) {
      return { success: false, error: err.message || 'Invalid credentials' };
    }
  };

  const register = (email, password) => {
    const accounts = getUserAccounts();
    if (accounts[email]) {
      return { success: false, error: 'Email already registered' };
    }
    
    accounts[email] = {
      password,
      createdAt: new Date().toISOString(),
      profileComplete: false
    };
    
    updateUserAccounts(accounts);
    setUserAccounts(accounts);
    return { success: true };
  };

  const logout = () => {
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    localStorage.removeItem('applicantNo');
    setCurrentUserState(null);
  };

  const updateProfile = (email, profileData) => {
    const profiles = { ...userProfiles, [email]: profileData };
    updateUserProfiles(profiles);
    setUserProfiles(profiles);
    
    // Mark profile as complete
    const accounts = { ...userAccounts };
    if (accounts[email]) {
      accounts[email].profileComplete = true;
      updateUserAccounts(accounts);
      setUserAccounts(accounts);
    }
  };

  const value = {
    currentUser,
    setCurrentUserState,
    userProfile, // Fetch userProfile globally
    fetchProfile, // Allow manual refresh if needed
    userProfiles,
    userAccounts,
    login,
    register,
    logout,
    updateProfile,
    loading
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};