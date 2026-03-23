// User accounts storage
export const getUserAccounts = () => {
  return JSON.parse(localStorage.getItem('userAccounts')) || {};
};

export const updateUserAccounts = (accounts) => {
  localStorage.setItem('userAccounts', JSON.stringify(accounts));
};

// User profiles storage
export const getUserProfiles = () => {
  return JSON.parse(localStorage.getItem('userProfiles')) || {};
};

export const updateUserProfiles = (profiles) => {
  localStorage.setItem('userProfiles', JSON.stringify(profiles));
};

// Current user
export const getCurrentUser = () => {
  return localStorage.getItem('currentUser');
};

export const setCurrentUser = (email) => {
  localStorage.setItem('currentUser', email);
};

// User applications
export const getUserApplications = () => {
  return JSON.parse(localStorage.getItem('userApplications')) || {};
};

export const updateUserApplications = (applications) => {
  localStorage.setItem('userApplications', JSON.stringify(applications));
};

// Add application for user
export const addUserApplication = (userEmail, application) => {
  const apps = getUserApplications();
  if (!apps[userEmail]) {
    apps[userEmail] = [];
  }
  apps[userEmail].push(application);
  updateUserApplications(apps);
  return apps;
};

// Cancel application
export const cancelUserApplication = (userEmail, scholarshipName) => {
  const apps = getUserApplications();
  if (apps[userEmail]) {
    apps[userEmail] = apps[userEmail].filter(app => app.name !== scholarshipName);
    updateUserApplications(apps);
  }
  return apps;
};