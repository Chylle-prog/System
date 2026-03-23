import React, { createContext, useState, useContext, useEffect } from 'react';
import { getCurrentUser, getUserProfiles, getUserAccounts, setCurrentUser, updateUserProfiles, updateUserAccounts } from '../utils/storage';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUserState] = useState(null);
  const [userProfiles, setUserProfiles] = useState({});
  const [userAccounts, setUserAccounts] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load data from localStorage on mount
    const user = getCurrentUser();
    const profiles = getUserProfiles();
    const accounts = getUserAccounts();
    
    setCurrentUserState(user);
    setUserProfiles(profiles);
    setUserAccounts(accounts);
    setLoading(false);
  }, []);

  const login = (email, password) => {
    const accounts = getUserAccounts();
    if (accounts[email] && accounts[email].password === password) {
      setCurrentUser(email);
      setCurrentUserState(email);
      return { success: true, user: email };
    }
    return { success: false, error: 'Invalid credentials' };
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
    setCurrentUserState, // Allow components to directly update the auth state
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