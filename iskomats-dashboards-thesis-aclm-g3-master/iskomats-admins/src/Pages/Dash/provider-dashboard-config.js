import africaLogo from '../../assets/ad1.jpg';
import vilmaLogo from '../../assets/ad2.jpg';

export const PROVIDER_DASHBOARD_ROUTE = '/provider-dashboard';

export const providerDashboardConfigs = {
  africa: {
    providerKey: 'africa',
    providerName: 'Mayor Africa',
    proNo: 1,
    logo: africaLogo,
  },
  vilma: {
    providerKey: 'vilma',
    providerName: 'Vilma',
    proNo: 2,
    logo: vilmaLogo,
  },
};

export const providerDashboardRoles = Object.keys(providerDashboardConfigs);

export function isProviderDashboardRole(role) {
  return providerDashboardRoles.includes((role || '').toLowerCase());
}

export function getProviderDashboardConfig(role) {
  return providerDashboardConfigs[(role || '').toLowerCase()] || null;
}