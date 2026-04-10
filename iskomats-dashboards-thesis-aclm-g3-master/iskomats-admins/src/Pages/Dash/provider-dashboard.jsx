import { Navigate } from 'react-router-dom';
import ScholarshipDashboard from './scholarship-dashboard';
import { getProviderDashboardConfig } from './provider-dashboard-config';

export default function ProviderDashboard() {
  const userRole = localStorage.getItem('userRole') || '';
  const config = getProviderDashboardConfig(userRole);

  if (!config) {
    return <Navigate to="/dash" replace />;
  }

  return <ScholarshipDashboard {...config} />;
}