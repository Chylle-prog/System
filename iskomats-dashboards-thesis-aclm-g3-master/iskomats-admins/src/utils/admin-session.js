export function clearAdminSession(options = {}) {
  const { preserveSuspended = false, markSessionExpired = false } = options;

  localStorage.removeItem('authToken');
  localStorage.removeItem('isLoggedIn');
  localStorage.removeItem('userRole');
  localStorage.removeItem('userEmail');
  localStorage.removeItem('userName');
  localStorage.removeItem('userFirstName');

  if (markSessionExpired) {
    localStorage.setItem('session_expired', 'true');
  } else {
    localStorage.removeItem('session_expired');
  }

  if (!preserveSuspended) {
    localStorage.removeItem('accountSuspended');
  }
}