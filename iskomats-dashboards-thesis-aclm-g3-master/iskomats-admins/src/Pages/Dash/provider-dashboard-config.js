import africaLogo from '../../assets/ad1.jpg';
import vilmaLogo from '../../assets/ad2.jpg';
import tulongLogo from '../../assets/ad3.jpg';

export const PROVIDER_DASHBOARD_ROUTE = '/provider-dashboard';

export const providerDashboardConfigs = {
  africa: {
    providerKey: 'africa',
    providerName: 'Africa',
    proNo: 1,
    logo: africaLogo,
  },
  vilma: {
    providerKey: 'vilma',
    providerName: 'Vilma',
    proNo: 2,
    logo: vilmaLogo,
  },
  tulong: {
    providerKey: 'tulong',
    providerName: 'Tulong',
    programName: 'Tulong Dunong Program',
    proNo: 3,
    logo: tulongLogo,
  },
};

export const providerDashboardRoles = Object.keys(providerDashboardConfigs);

export function isProviderDashboardRole(role) {
  return providerDashboardRoles.includes((role || '').toLowerCase());
}

export function getProviderDashboardConfig(role) {
  return providerDashboardConfigs[(role || '').toLowerCase()] || null;
}