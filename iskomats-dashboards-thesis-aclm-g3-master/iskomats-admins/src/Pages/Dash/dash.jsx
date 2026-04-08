import { useEffect, useMemo, useState } from 'react';
import {
  FaBan,
  FaChartBar,
  FaCheckCircle,
  FaChevronDown,
  FaClock,
  FaEdit,
  FaExclamationCircle,
  FaFileCsv,
  FaFileExcel,
  FaFilePdf,
  FaKey,
  FaLock,
  FaPlus,
  FaPrint,
  FaSearch,
  FaSignInAlt,
  FaSignOutAlt,
  FaTachometerAlt,
  FaTimesCircle,
  FaTrash,
  FaUnlock,
  FaUser,
  FaUserEdit,
  FaUserGraduate,
  FaUsersCog,
} from 'react-icons/fa';
import * as XLSX from 'xlsx';
import { adminAPI } from '../../services/api';
import socketService from '../../services/socket';

const ACTION_EVENT_OPTIONS = [
  { label: 'Login', value: 'Login' },
  { label: 'Logout', value: 'Logout' },
  { label: 'Password / Security', value: 'Password' },
  { label: 'Profile Updates', value: 'Profile' },
  { label: 'Account Management', value: 'Account' },
];

const emptyStatistics = {
  totalUsers: 0,
  totalApplicants: 0,
  usersByRole: [],
};

function splitFullName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: parts[0] };
  }
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1],
  };
}

function normalizeAccount(account) {
  return {
    id: account.id,
    email: account.email || 'No email',
    name: account.name || 'Unknown',
    firstName: account.first_name || account.firstName || account.name || 'Unknown',
    lastName: account.last_name || account.lastName || '',
    role: (account.role || '').toLowerCase() || 'scholar',
    type: account.type || (account.role === 'admin' ? 'Admin' : 'Applicant'),
    scholarship: account.scholarship || 'Unassigned',
    providerNo: account.provider_no || account.providerNo || null,
    status: account.status || 'Unknown',
    joined: account.joined || null,
    locked: account.locked || false,
  };
}

function buildCreatedAccount(account, accountType) {
  return normalizeAccount({
    ...account,
    type: account.type || accountType,
    joined: account.joined || new Date().toISOString().split('T')[0],
  });
}

function normalizeLog(log) {
  return {
    id: log.id,
    user: log.user || 'Unknown',
    activity: log.activity || 'Activity',
    status: (log.status || 'pending').toLowerCase(),
    scholarship: log.scholarship || 'Unassigned',
    date: log.date || null,
  };
}

function statusClasses(status) {
  const normalizedStatus = (status || '').toLowerCase();
  if (normalizedStatus === 'success' || normalizedStatus === 'accepted' || normalizedStatus === 'registered') {
    return {
      dot: 'bg-green-500',
      text: 'text-green-600',
    };
  }
  if (normalizedStatus === 'pending') {
    return {
      dot: 'bg-yellow-500',
      text: 'text-yellow-600',
    };
  }
  return {
    dot: 'bg-red-500',
    text: 'text-red-600',
  };
}

export default function Dash() {
  const [submenus, setSubmenus] = useState({ reports: false });
  const [activeTab, setActiveTab] = useState('dashboard');
  const userName = localStorage.getItem('userName') || 'Admin';

  const [accountModal, setAccountModal] = useState({ open: false, mode: 'add', data: null });
  const [reportModal, setReportModal] = useState({ open: false });
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', targetId: null, message: '', action: null });

  const [accountType, setAccountType] = useState('Admin');
  const [accountSearch, setAccountSearch] = useState('');
  const [managedAcctProgramFilter, setManagedAcctProgramFilter] = useState('All');
  const [accReportFilter, setAccReportFilter] = useState({ program: 'All', role: 'All', search: '' });
  const [actReportFilter, setActReportFilter] = useState({ program: 'All', action: 'All', search: '' });
  const [reportForm, setReportForm] = useState({
    type: 'Accounts',
    startDate: '',
    endDate: '',
    program: 'All',
    role: 'All',
    format: 'Excel',
  });
  const [printData, setPrintData] = useState([]);
  const [printMetadata, setPrintMetadata] = useState({ title: '', subtitle: '', date: '' });
  const [accountForm, setAccountForm] = useState({
    fullName: '',
    email: '',
    username: '',
    password: '',
    role: 'Admin',
    status: 'Active',
    scholarship: '',
  });

  const [accounts, setAccounts] = useState([]);
  const [activities, setActivities] = useState([]);
  const [providers, setProviders] = useState([]);
  const [statistics, setStatistics] = useState(emptyStatistics);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageError, setPageError] = useState('');

  const availablePrograms = useMemo(() => {
    // Use providers from database instead of deriving from accounts
    return providers.map(p => p.provider_name).sort();
  }, [providers]);

  const providerStats = useMemo(() => {
    // Calculate users and applicants per provider
    return providers.map((provider) => {
      const usersCount = accounts.filter((a) => a.scholarship === provider.provider_name && a.type === 'Admin').length;
      const applicantsCount = accounts.filter((a) => a.scholarship === provider.provider_name && a.type === 'Applicant').length;
      return {
        ...provider,
        usersCount,
        applicantsCount,
        totalAccounts: usersCount + applicantsCount,
      };
    });
  }, [providers, accounts]);

  const loadDashboardData = async (showLoader = true) => {
    if (showLoader) {
      setIsLoading(true);
    }
    setPageError('');

    const [accountsResult, statisticsResult, logsResult, providersResult] = await Promise.allSettled([
      adminAPI.getAllAccounts(),
      adminAPI.getDashboardStats(),
      adminAPI.getActivityLogs(),
      scholarshipAPI.getProviders(),
    ]);

    const errors = [];

    if (accountsResult.status === 'fulfilled') {
      const nextAccounts = (accountsResult.value.data.accounts || []).map(normalizeAccount);
      setAccounts(nextAccounts);
    } else {
      errors.push('accounts');
      setAccounts([]);
    }

    if (statisticsResult.status === 'fulfilled') {
      setStatistics(statisticsResult.value.data.statistics || emptyStatistics);
    } else {
      errors.push('statistics');
      setStatistics(emptyStatistics);
    }

    if (logsResult.status === 'fulfilled') {
      const nextLogs = (logsResult.value.data.logs || []).map(normalizeLog);
      setActivities(nextLogs);
    } else {
      errors.push('activity logs');
      setActivities([]);
    }

    if (providersResult.status === 'fulfilled') {
      setProviders(providersResult.value.data || []);
    } else {
      errors.push('scholarship providers');
      setProviders([]);
    }

    if (errors.length > 0) {
      setPageError(`Failed to load ${errors.join(', ')} from the database.`);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    loadDashboardData();

    // System-wide synchronization: Listen for account changes from other sources
    const token = localStorage.getItem('authToken');
    if (token) {
      socketService.connect(token);
      
      const unsubAccount = socketService.subscribe('account_change', (data) => {
        console.log('[SYNC] Account change detected live:', data);
        // Silently refresh data to ensure reflection in real-time
        loadDashboardData(false);
      });

      return () => {
        unsubAccount();
        socketService.disconnect();
      };
    }
  }, []);

  const filteredManagedAccounts = useMemo(() => {
    const search = accountSearch.trim().toLowerCase();
    return accounts.filter((account) => {
      const matchesType = account.type === accountType;
      const matchesProgram = managedAcctProgramFilter === 'All' || account.scholarship === managedAcctProgramFilter;
      const matchesSearch = !search || [account.name, account.email, String(account.id)].some((value) => (value || '').toLowerCase().includes(search));
      return matchesType && matchesProgram && matchesSearch;
    });
  }, [accounts, accountSearch, accountType, managedAcctProgramFilter]);

  const filteredAccountReport = useMemo(() => {
    return accounts.filter((account) => {
      const matchesProgram = accReportFilter.program === 'All' || account.scholarship === accReportFilter.program;
      const matchesRole = accReportFilter.role === 'All' || account.role === accReportFilter.role.toLowerCase();
      const search = accReportFilter.search.trim().toLowerCase();
      const matchesSearch = !search || [account.name, account.email].some((value) => (value || '').toLowerCase().includes(search));
      return matchesProgram && matchesRole && matchesSearch;
    });
  }, [accounts, accReportFilter]);

  const filteredActivityReport = useMemo(() => {
    return activities.filter((activity) => {
      const matchesProgram = actReportFilter.program === 'All' || activity.scholarship === actReportFilter.program;
      const matchesAction = actReportFilter.action === 'All'
        || (activity.activity || '').toLowerCase().includes(actReportFilter.action.toLowerCase());
      const search = actReportFilter.search.trim().toLowerCase();
      const matchesSearch = !search || [activity.user, activity.activity, activity.scholarship].some((value) => (value || '').toLowerCase().includes(search));
      return matchesProgram && matchesAction && matchesSearch;
    });
  }, [activities, actReportFilter]);

  const toggleSubmenu = (menu) => {
    setSubmenus((previousState) => ({ ...previousState, [menu]: !previousState[menu] }));
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return 'No timestamp';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toISOString().split('T')[0];
  };

  const formatActivityTimestamp = (timestamp) => {
    if (!timestamp) return 'No timestamp';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };

  const openAccountModal = (mode, data = null) => {
    setAccountModal({ open: true, mode, data });
    setPageError('');

    if (mode === 'edit' && data) {
      setAccountForm({
        fullName: data.name || '',
        email: data.email || '',
        username: data.username || data.email?.split('@')[0] || '',
        password: '',
        role: data.type === 'Admin' ? 'Admin' : 'Scholar',
        status: data.status || 'Active',
        scholarship: data.scholarship || '',
      });
      return;
    }

    setAccountForm({
      fullName: '',
      email: '',
      username: '',
      password: '',
      role: accountType === 'Applicant' ? 'Scholar' : 'Admin',
      status: 'Active',
      scholarship: '',
    });
  };

  const exportToExcel = (data, filename) => {
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  const handleAccountSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setPageError('');

    try {
      const { firstName, lastName } = splitFullName(accountForm.fullName);

      if (!firstName || !lastName) {
        throw new Error('Enter a full name with at least a first and last name.');
      }

      if (accountModal.mode === 'add') {
        if (!accountForm.password.trim()) {
          throw new Error('A password is required for new database accounts.');
        }

        const response = await adminAPI.createAccount({
          email: accountForm.email.trim(),
          password: accountForm.password,
          role: accountForm.role === 'Admin' ? 'admin' : 'scholar',
          firstName,
          lastName,
          scholarship: accountForm.scholarship || 'All',
        });

        const createdAccount = response.data?.account;
        if (createdAccount) {
          const normalizedCreatedAccount = buildCreatedAccount(createdAccount, accountForm.role === 'Admin' ? 'Admin' : 'Applicant');
          setAccounts((previousAccounts) => [normalizedCreatedAccount, ...previousAccounts]);
          setStatistics((previousStatistics) => ({
            ...previousStatistics,
            totalUsers: (previousStatistics.totalUsers || 0) + 1,
            totalApplicants: normalizedCreatedAccount.type === 'Applicant'
              ? (previousStatistics.totalApplicants || 0) + 1
              : previousStatistics.totalApplicants,
          }));
        } else {
          await loadDashboardData(false);
        }
      } else {
        // Now support editing both Admin and Applicant (Scholar) accounts
        await adminAPI.updateAccount(accountModal.data.id, {
          name: accountForm.fullName.trim(),
          email: accountForm.email.trim(),
          scholarship: accountForm.scholarship || 'All',
        });

        setAccounts((previousAccounts) => previousAccounts.map((account) => (
          account.id === accountModal.data.id
            ? normalizeAccount({ ...account, name: accountForm.fullName.trim(), email: accountForm.email.trim(), scholarship: accountForm.scholarship || 'All' })
            : account
        )));
      }

      setAccountModal({ open: false, mode: 'add', data: null });
    } catch (error) {
      setPageError(error.response?.data?.message || error.message || 'Failed to save account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const requestLockAccount = (account) => {
    const isLocking = !account.locked;
    setConfirmModal({
      open: true,
      type: isLocking ? 'Lock' : 'Unlock',
      targetId: account.id,
      message: `Are you sure you want to ${isLocking ? 'suspend' : 'reactivate'} ${account.name}? ${isLocking ? 'Suspending this account will immediately revoke all access and prevent future logins across the entire system.' : 'Reactivating this account will restore full access immediately.'}`,
      action: async () => {
        try {
          await adminAPI.lockAccount(account.id, isLocking);
          setAccounts(accounts.map(a => a.id === account.id ? { ...a, locked: isLocking } : a));
          setConfirmModal({ open: false, type: '', targetId: null, message: '', action: null });
        } catch (error) {
          setPageError(error.response?.data?.message || error.message || `Failed to ${isLocking ? 'lock' : 'unlock'} account.`);
          setConfirmModal({ open: false, type: '', targetId: null, message: '', action: null });
        }
      },
    });
  };

  const requestDeleteAccount = (account) => {
    // Super Admin can delete both Admin and Applicant accounts

    setConfirmModal({
      open: true,
      type: 'Delete',
      targetId: account.id,
      message: `Are you sure you want to PERMANENTLY delete ${account.name}? This action is irreversible and will remove all associated database records immediately.`,
      action: async () => {
        try {
          await adminAPI.deleteAccount(account.id);
          setConfirmModal({ open: false, type: '', targetId: null, message: '', action: null });
          await loadDashboardData(false);
        } catch (error) {
          setPageError(error.response?.data?.message || error.message || 'Failed to delete account.');
          setConfirmModal({ open: false, type: '', targetId: null, message: '', action: null });
        }
      },
    });
  };

  const handleGenerateReport = (event) => {
    event.preventDefault();
    const data = reportForm.type === 'Accounts' ? filteredAccountReport : filteredActivityReport;

    if (reportForm.format === 'Excel') {
      exportToExcel(data, `${reportForm.type}_Report_${new Date().toISOString().split('T')[0]}`);
      return;
    }

    if (reportForm.format === 'PDF') {
      setPrintData(data);
      setPrintMetadata({
        title: `${reportForm.type} Report`,
        subtitle: `Program: ${reportForm.program} | Date: ${new Date().toLocaleDateString()}`,
        date: new Date().toLocaleString(),
      });
      setReportModal({ open: false });
      setTimeout(() => {
        window.print();
      }, 300);
      return;
    }

    exportToExcel(data, `${reportForm.type}_Report_${new Date().toISOString().split('T')[0]}`);
  };

  const getActivityIcon = (status) => {
    switch ((status || '').toLowerCase()) {
      case 'success':
        return <FaCheckCircle className="text-green-600" />;
      case 'pending':
        return <FaClock className="text-yellow-600" />;
      case 'failed':
        return <FaTimesCircle className="text-red-600" />;
      default:
        return <FaClock className="text-gray-600" />;
    }
  };

  const getActivityTypeIcon = (activity) => {
    const act = (activity || '').toLowerCase();
    if (act.includes('failed') || act.includes('deleted')) return <FaTimesCircle />;
    if (act.includes('login')) return <FaSignInAlt />;
    if (act.includes('logout')) return <FaSignOutAlt />;
    if (act.includes('password') || act.includes('security')) return <FaKey />;
    if (act.includes('profile') || act.includes('update')) return <FaUser />;
    if (act.includes('locked') || act.includes('lock')) return <FaBan />;
    if (act.includes('account')) return <FaUserEdit />;
    return <FaClock />;
  };

  const dashboardCards = [
    {
      label: 'Total Accounts',
      value: statistics.totalUsers || accounts.length,
      icon: <FaUsersCog />,
      color: '#800020',
    },
    {
      label: 'Total Students',
      value: statistics.totalApplicants || accounts.filter((account) => account.type === 'Applicant').length,
      icon: <FaUserGraduate />,
      color: '#16a34a',
    },
    {
      label: 'Activity Records',
      value: activities.length,
      icon: <FaClock />,
      color: '#d97706',
    },
  ];

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-blue-50/30 pt-20">
      <aside className="w-64 flex-shrink-0 bg-gradient-to-b from-[#800020] to-[#650018] text-white shadow-xl flex flex-col">
        <h2 className="text-center text-xl font-bold py-6 flex items-center justify-center gap-2 border-b border-white/10 mx-4">
          <FaTachometerAlt className="text-2xl" /> Iskomats Admin
        </h2>
        <nav className="flex-1 px-4 space-y-2 py-6">
          <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-white/20' : 'hover:bg-white/10'}`}>
            <FaTachometerAlt /> Dashboard
          </button>
          <button onClick={() => setActiveTab('manage-accounts')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === 'manage-accounts' ? 'bg-white/20' : 'hover:bg-white/10'}`}>
            <FaUsersCog /> Manage Accounts
          </button>

          <div className="space-y-1">
            <button onClick={() => toggleSubmenu('reports')} className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-white/10">
              <div className="flex items-center gap-3"><FaChartBar /> Reports</div>
              <FaChevronDown className={`transition-transform ${submenus.reports ? 'rotate-180' : ''}`} />
            </button>
            {submenus.reports && (
              <div className="ml-4 space-y-1 mt-1 border-l border-white/20 pl-2">
                <button onClick={() => setActiveTab('account-reports')} className={`w-full text-left px-4 py-2 rounded-lg text-sm hover:bg-white/10 ${activeTab === 'account-reports' ? 'bg-white/20' : ''}`}>Account Reports</button>
                <button onClick={() => setActiveTab('activity-reports')} className={`w-full text-left px-4 py-2 rounded-lg text-sm hover:bg-white/10 ${activeTab === 'activity-reports' ? 'bg-white/20' : ''}`}>Activity Reports</button>
              </div>
            )}
          </div>
        </nav>
        <div className="p-4 border-t border-white/10 space-y-3">
          <button onClick={() => setReportModal({ open: true })} className="w-full py-3 bg-white text-[#800020] font-black rounded-xl shadow-lg hover:bg-gray-100 transition-all flex items-center justify-center gap-2">
            <FaPrint /> Generate Report
          </button>
          <button onClick={() => loadDashboardData(false)} className="w-full py-3 bg-white/10 text-white font-black rounded-xl hover:bg-white/15 transition-all text-xs uppercase tracking-widest">
            Refresh Data
          </button>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-y-auto">
        <header className="bg-white rounded-2xl shadow-sm px-8 py-5 mb-8 flex items-center justify-between border border-gray-100">
          <div>
            <h1 className="text-2xl font-black text-[#800020] tracking-tight uppercase">{activeTab.replace('-', ' ')}</h1>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Database-Backed Administrator Control Panel</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-black text-gray-900">{userName}</p>
              <p className="text-[10px] font-bold text-green-600 uppercase">Live Database Mode</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#800020] flex items-center justify-center text-white font-black">
              {userName.charAt(0)}
            </div>
          </div>
        </header>

        {pageError && (
          <div className="mb-6 rounded-2xl border border-red-100 bg-red-50 px-6 py-4 text-sm font-bold text-red-700">
            {pageError}
          </div>
        )}

        {isLoading ? (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-10 text-center">
            <p className="text-sm font-black uppercase tracking-widest text-gray-500">Loading dashboard data from PostgreSQL...</p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && (
              <div className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {dashboardCards.map((card) => (
                    <div key={card.label} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-4">
                        <div className="p-3 rounded-2xl" style={{ backgroundColor: `${card.color}15`, color: card.color }}>{card.icon}</div>
                        <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-md">DB</span>
                      </div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{card.label}</p>
                      <h3 className="text-3xl font-black text-gray-900 mt-1">{card.value}</h3>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                      <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">System Audit Stream</h3>
                      <button onClick={() => setActiveTab('activity-reports')} className="text-xs font-bold text-[#800020] hover:underline">Full Audit</button>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {activities.length === 0 ? (
                        <div className="p-6 text-sm font-bold text-gray-400">No audit records found.</div>
                      ) : (
                        activities.slice(0, 6).map((activity) => (
                          <div key={activity.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white ${activity.status === 'success' ? 'bg-green-500' : activity.status === 'pending' ? 'bg-yellow-500' : 'bg-red-500'}`}>
                              {getActivityIcon(activity.status)}
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-center mb-0.5 gap-4">
                                <span className="text-sm font-black text-gray-900">{activity.user}</span>
                                <span className="text-[10px] font-bold text-gray-400 uppercase">{formatActivityTimestamp(activity.date)}</span>
                              </div>
                              <p className="text-xs text-gray-500">{activity.activity} - <span className="text-[#800020] font-bold">{activity.scholarship}</span></p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="space-y-8">
                    <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                      <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-6 border-l-4 border-[#800020] pl-4">Program Distribution</h4>
                      <div className="space-y-6">
                        {providerStats.length === 0 ? (
                          <p className="text-sm font-bold text-gray-400">No scholarship providers found.</p>
                        ) : (
                          providerStats.map((provider) => {
                            const percentage = accounts.length > 0 ? (provider.totalAccounts / accounts.length) * 100 : 0;
                            return (
                              <div key={provider.pro_no} className="space-y-2">
                                <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500 gap-2">
                                  <span>{provider.provider_name}</span>
                                  <span className="text-right flex gap-2">
                                    <span style={{color: '#800020'}}>👤 {provider.usersCount}</span>
                                    <span style={{color: '#16a34a'}}>👨‍🎓 {provider.applicantsCount}</span>
                                  </span>
                                </div>
                                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                                  <div className="bg-[#800020] h-full rounded-full" style={{ width: `${percentage}%` }}></div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'manage-accounts' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-white p-4 rounded-3xl shadow-sm border border-gray-100 gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="flex bg-gray-100 p-1 rounded-2xl">
                      {['Admin', 'Applicant'].map((type) => (
                        <button key={type} onClick={() => setAccountType(type)} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${accountType === type ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:bg-white/50'}`}>
                          {type === 'Applicant' ? 'Students' : `${type}s`}
                        </button>
                      ))}
                    </div>
                    <div className="text-xs text-gray-400 font-bold">FILTER:</div>
                    <select value={managedAcctProgramFilter} onChange={(event) => setManagedAcctProgramFilter(event.target.value)} className="px-4 py-2 bg-gray-100 border-none rounded-xl text-xs font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]">
                      <option value="All">All Programs</option>
                      {availablePrograms.map((program) => (
                        <option key={program} value={program}>{program}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={() => openAccountModal('add')} className="px-6 py-2 bg-[#800020] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#800020]/20 flex items-center gap-2 hover:bg-[#650018] transition-all">
                    <FaPlus /> New {accountType === 'Applicant' ? 'Student' : accountType}
                  </button>
                </div>

                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-50 flex items-center gap-4">
                    <div className="relative flex-1">
                      <FaSearch className="absolute left-4 top-3.5 text-gray-300" />
                      <input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} type="text" placeholder="Search by name, email, or ID..." className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#800020]" />
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/50 text-left border-b border-gray-100">
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Identified User</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Scholarship</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Account Status</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Joined</th>
                        <th className="px-8 py-4 text-right font-black text-gray-400 uppercase tracking-widest text-[10px]">Control</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredManagedAccounts.map((account) => {
                        const statusStyle = statusClasses(account.status);
                        return (
                          <tr key={account.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-8 py-5">
                              <p className="font-black text-gray-900">{account.name}</p>
                              <p className="text-xs text-gray-400">{account.email}</p>
                            </td>
                            <td className="px-8 py-5">
                              <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-100 bg-gray-50 text-gray-600">{account.scholarship}</span>
                            </td>
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`}></span>
                                <span className={`text-[10px] font-black uppercase tracking-widest ${statusStyle.text}`}>{account.status}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-xs text-gray-400 font-mono">{formatDate(account.joined)}</td>
                            <td className="px-8 py-5 text-right space-x-2">
                               <button onClick={() => openAccountModal('edit', account)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"><FaUserEdit /></button>
                               <button onClick={() => requestLockAccount(account)} className={`p-2 rounded-lg transition-all ${account.locked ? 'text-orange-600 hover:bg-orange-50' : 'text-slate-600 hover:bg-slate-50'}`}>{account.locked ? <FaLock /> : <FaUnlock />}</button>
                               <button onClick={() => requestDeleteAccount(account)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"><FaTrash /></button>
                            </td>
                          </tr>
                        );
                      })}
                      {filteredManagedAccounts.length === 0 && (
                        <tr>
                          <td colSpan="5" className="px-8 py-12 text-center text-sm font-bold text-gray-400">No database-backed accounts matched your filters.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'account-reports' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex-wrap gap-4">
                  <h2 className="text-xl font-black text-gray-900 uppercase">Account Distribution</h2>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <FaSearch className="absolute left-3 top-3 text-gray-300 text-xs" />
                      <input value={accReportFilter.search} onChange={(event) => setAccReportFilter({ ...accReportFilter, search: event.target.value })} placeholder="Search accounts..." className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]" />
                    </div>
                    <select value={accReportFilter.program} onChange={(event) => setAccReportFilter({ ...accReportFilter, program: event.target.value })} className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]">
                      <option value="All">All Programs</option>
                      {availablePrograms.map((program) => (
                        <option key={program} value={program}>{program}</option>
                      ))}
                    </select>
                    <select value={accReportFilter.role} onChange={(event) => setAccReportFilter({ ...accReportFilter, role: event.target.value })} className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]">
                      <option value="All">All Roles</option>
                      <option value="Admin">Admin</option>
                      <option value="Scholar">Scholar</option>
                    </select>
                    <button onClick={() => exportToExcel(filteredAccountReport, 'Account_Distribution_Report')} className="px-6 py-2 bg-[#800020] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#800020]/20 flex items-center gap-2">
                      <FaFileExcel /> Export ({filteredAccountReport.length})
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50/50 text-left border-b border-gray-100">
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Identified User</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">System Role</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Scholarship Program</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Account Status</th>
                        <th className="px-8 py-4 font-black text-gray-400 uppercase tracking-widest text-[10px]">Registration Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredAccountReport.map((account) => {
                        const statusStyle = statusClasses(account.status);
                        return (
                          <tr key={account.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-8 py-5">
                              <p className="font-black text-gray-900">{account.name}</p>
                              <p className="text-xs text-gray-400">{account.email}</p>
                            </td>
                            <td className="px-8 py-5">
                              <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${account.role === 'admin' ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>{account.role}</span>
                            </td>
                            <td className="px-8 py-5 font-bold text-gray-600">{account.scholarship}</td>
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`}></span>
                                <span className={`text-[10px] font-black uppercase tracking-widest ${statusStyle.text}`}>{account.status}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-xs text-gray-400 font-mono">{formatDate(account.joined)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'activity-reports' && (
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex justify-between items-center flex-wrap gap-4">
                  <h2 className="text-xl font-black text-gray-900 uppercase">Audit Intelligence</h2>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                      <FaSearch className="absolute left-3 top-3 text-gray-300 text-xs" />
                      <input value={actReportFilter.search} onChange={(event) => setActReportFilter({ ...actReportFilter, search: event.target.value })} placeholder="Search logs..." className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]" />
                    </div>
                    <select value={actReportFilter.program} onChange={(event) => setActReportFilter({ ...actReportFilter, program: event.target.value })} className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]">
                      <option value="All">All Programs</option>
                      {availablePrograms.map((program) => (
                        <option key={program} value={program}>{program}</option>
                      ))}
                    </select>
                    <select value={actReportFilter.action} onChange={(event) => setActReportFilter({ ...actReportFilter, action: event.target.value })} className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]">
                      <option value="All">All Actions</option>
                      {ACTION_EVENT_OPTIONS.map((action) => (
                        <option key={action.value} value={action.value}>{action.label}</option>
                      ))}
                    </select>
                    <button onClick={() => exportToExcel(filteredActivityReport, 'Activity_Log')} className="px-6 py-2 bg-[#800020] text-white rounded-xl font-black text-xs uppercase tracking-widest hover:opacity-90 transition-all flex items-center gap-2 shadow-lg shadow-[#800020]/20">
                      <FaFileExcel /> Export ({filteredActivityReport.length})
                    </button>
                  </div>
                </div>
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50/50 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                          <th className="px-8 py-4">Actor</th>
                          <th className="px-8 py-4">Action Event</th>
                          <th className="px-8 py-4">Scholarship</th>
                          <th className="px-8 py-4">Temporal Mark</th>
                          <th className="px-8 py-4 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {filteredActivityReport.map((activity) => (
                          <tr key={activity.id} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-8 py-4 font-black text-gray-900">{activity.user}</td>
                            <td className="px-8 py-4">
                              <div className="flex items-center gap-2">
                                <span className="text-[#800020] opacity-30">{getActivityTypeIcon(activity.activity)}</span>
                                <span className="font-bold text-gray-600">{activity.activity}</span>
                              </div>
                            </td>
                            <td className="px-8 py-4"><span className="text-[10px] font-black text-[#800020] border border-[#800020]/20 px-2 py-0.5 rounded uppercase tracking-widest">{activity.scholarship}</span></td>
                            <td className="px-8 py-4 font-mono text-xs text-gray-400 italic">{formatActivityTimestamp(activity.date)}</td>
                            <td className="px-8 py-4 text-center"><div className="flex justify-center">{getActivityIcon(activity.status)}</div></td>
                          </tr>
                        ))}
                        {filteredActivityReport.length === 0 && (
                          <tr>
                            <td colSpan="5" className="px-8 py-12 text-center text-sm font-bold text-gray-400">No audit records matched your filters.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {accountModal.open && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl border border-gray-200">
            {/* Header */}
            <div className="bg-[#800020] px-12 py-8 text-white">
              <h3 className="text-2xl font-black uppercase tracking-wide">Create Account</h3>
              <p className="text-xs font-bold opacity-80 uppercase tracking-widest mt-1">ISKOMATS Identity Access</p>
            </div>

            {/* Form */}
            <form onSubmit={handleAccountSubmit} className="p-12 space-y-8">
              {/* Full Name */}
              <div>
                <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Legal Full Name</label>
                <input 
                  required 
                  value={accountForm.fullName} 
                  onChange={(event) => setAccountForm({ ...accountForm, fullName: event.target.value })} 
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all" 
                  placeholder=""
                />
              </div>

              {/* Email & Username */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Email Address</label>
                  <input 
                    required 
                    type="email" 
                    value={accountForm.email} 
                    onChange={(event) => setAccountForm({ ...accountForm, email: event.target.value })} 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all" 
                  />
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Username</label>
                  <input 
                    required 
                    value={accountForm.username} 
                    onChange={(event) => setAccountForm({ ...accountForm, username: event.target.value })} 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all" 
                  />
                </div>
              </div>

              {/* System Role & Scholarship */}
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">System Role</label>
                  <select 
                    value={accountForm.role} 
                    onChange={(event) => setAccountForm({ ...accountForm, role: event.target.value })}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all cursor-pointer"
                  >
                    <option value="Admin">Admin</option>
                    <option value="Scholar">Scholar</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Scholarship Program</label>
                  <select 
                    value={accountForm.scholarship} 
                    onChange={(event) => setAccountForm({ ...accountForm, scholarship: event.target.value })}
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all cursor-pointer"
                  >
                    <option value="All">All / Global</option>
                    {availablePrograms.map((program) => (
                      <option key={program} value={program}>{program}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Access Status */}
              <div>
                <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Access Status</label>
                <select 
                  value={accountForm.status} 
                  onChange={(event) => setAccountForm({ ...accountForm, status: event.target.value })}
                  className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all cursor-pointer"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>

              {/* Password (only for add mode) */}
              {accountModal.mode === 'add' && (
                <div>
                  <label className="text-xs font-black text-gray-500 uppercase tracking-widest block mb-3">Secure Passcode</label>
                  <input 
                    required 
                    type="password" 
                    value={accountForm.password} 
                    onChange={(event) => setAccountForm({ ...accountForm, password: event.target.value })} 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-lg text-sm font-semibold focus:ring-2 focus:ring-[#800020] focus:border-transparent outline-none transition-all" 
                  />
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-6 pt-8">
                <button 
                  type="button" 
                  onClick={() => setAccountModal({ open: false, mode: 'add', data: null })} 
                  className="flex-1 py-4 text-gray-500 font-black uppercase text-xs tracking-widest hover:text-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting} 
                  className="flex-1 py-4 bg-[#800020] text-white font-black uppercase rounded-2xl text-xs tracking-widest shadow-lg shadow-[#800020]/30 hover:bg-[#650018] transition-all disabled:opacity-60"
                >
                  {isSubmitting ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reportModal.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in duration-300">
            <div className="bg-gradient-to-br from-gray-900 to-black p-10 text-white relative">
              <FaChartBar className="absolute -top-6 -right-6 text-[160px] opacity-10 rotate-12" />
              <h3 className="text-3xl font-black uppercase tracking-tighter leading-none">Intelligence<br />Reports</h3>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-[4px] mt-4">Database Export Engine</p>
            </div>
            <form onSubmit={handleGenerateReport} className="p-10 space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Target Data Module</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Accounts', 'Activities'].map((type) => (
                      <button type="button" key={type} onClick={() => setReportForm({ ...reportForm, type })} className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${reportForm.type === type ? 'bg-[#800020] text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>{type}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Program Filter</label>
                  <select value={reportForm.program} onChange={(event) => setReportForm({ ...reportForm, program: event.target.value })} className="w-full p-4 bg-gray-50 border-none rounded-2xl text-xs font-black focus:ring-2 focus:ring-[#800020] outline-none">
                    <option value="All">All Programs</option>
                    {availablePrograms.map((program) => (
                      <option key={program} value={program}>{program}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Export Format</label>
                  <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-2xl">
                    <button type="button" onClick={() => setReportForm({ ...reportForm, format: 'Excel' })} className={`flex-1 py-3 rounded-xl flex items-center justify-center ${reportForm.format === 'Excel' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'}`}><FaFileExcel /></button>
                    <button type="button" onClick={() => setReportForm({ ...reportForm, format: 'PDF' })} className={`flex-1 py-3 rounded-xl flex items-center justify-center ${reportForm.format === 'PDF' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400'}`}><FaFilePdf /></button>
                    <button type="button" onClick={() => setReportForm({ ...reportForm, format: 'CSV' })} className={`flex-1 py-3 rounded-xl flex items-center justify-center ${reportForm.format === 'CSV' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-400'}`}><FaFileCsv /></button>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setReportModal({ open: false })} className="flex-1 py-5 font-black text-gray-400 hover:text-gray-600 rounded-3xl transition-all uppercase text-[10px] tracking-widest">Dismiss</button>
                <button type="submit" className="flex-1 py-5 bg-black text-white font-black rounded-3xl shadow-2xl hover:bg-gray-800 transition-all uppercase text-[10px] tracking-[3px] flex items-center justify-center gap-2">
                  <FaPrint /> Generate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmModal.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xl z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-12 max-w-sm w-full text-center shadow-2xl border border-white/20">
            <div className={`w-28 h-28 rounded-full mx-auto flex items-center justify-center mb-8 ${confirmModal.type === 'Delete' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              <FaExclamationCircle className="text-5xl animate-bounce" />
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-2 uppercase tracking-tighter">{confirmModal.type} Account?</h3>
            <p className="text-gray-400 text-sm font-bold leading-relaxed mb-10">{confirmModal.message}</p>
            <div className="flex flex-col gap-3">
              <button onClick={confirmModal.action} className={`w-full py-5 text-white font-black rounded-3xl shadow-xl transition-all uppercase text-xs tracking-widest ${confirmModal.type === 'Delete' ? 'bg-red-600 shadow-red-600/20 hover:bg-red-700' : confirmModal.type === 'Lock' ? 'bg-orange-600 shadow-orange-600/20 hover:bg-orange-700' : confirmModal.type === 'Unlock' ? 'bg-green-600 shadow-green-600/20 hover:bg-green-700' : 'bg-amber-600 shadow-amber-600/20 hover:bg-amber-700'}`}>Yes, Execute</button>
              <button onClick={() => setConfirmModal({ open: false, type: '', targetId: null, message: '', action: null })} className="w-full py-5 font-black text-gray-400 hover:bg-gray-50 rounded-3xl transition-all uppercase text-xs tracking-widest">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="print-only p-8 bg-white min-h-screen w-full">
        <div className="report-header mb-8 text-center border-b-4 border-[#800020] pb-6">
          <h1 className="report-title text-4xl font-black text-[#800020] uppercase tracking-tighter">{printMetadata.title}</h1>
          <p className="report-subtitle text-lg text-gray-500 font-bold mt-2">{printMetadata.subtitle}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-4">Generated via Iskomats Admin Database Export</p>
        </div>

        <table className="w-full border-collapse">
          <thead>
            {reportForm.type === 'Accounts' ? (
              <tr className="bg-gray-50 border-y border-gray-200">
                <th className="p-4 text-xs font-black uppercase text-gray-500">ID</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Name</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Email</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Role</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Status</th>
              </tr>
            ) : (
              <tr className="bg-gray-50 border-y border-gray-200">
                <th className="p-4 text-xs font-black uppercase text-gray-500">Actor</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Activity</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Program</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Timestamp</th>
                <th className="p-4 text-xs font-black uppercase text-gray-500">Status</th>
              </tr>
            )}
          </thead>
          <tbody>
            {printData.map((item, index) => (
              <tr key={item.id || index} className="border-b border-gray-100">
                {reportForm.type === 'Accounts' ? (
                  <>
                    <td className="p-4 text-sm font-bold text-gray-900">#ACC-{item.id}</td>
                    <td className="p-4 text-sm font-bold text-gray-700">{item.name}</td>
                    <td className="p-4 text-sm text-gray-500">{item.email}</td>
                    <td className="p-4 text-sm font-black text-[#800020] uppercase">{item.role}</td>
                    <td className="p-4 text-sm font-bold">{item.status}</td>
                  </>
                ) : (
                  <>
                    <td className="p-4 text-sm font-bold text-gray-900">{item.user}</td>
                    <td className="p-4 text-sm font-bold text-gray-700">{item.activity}</td>
                    <td className="p-4 text-sm font-black text-[#800020] uppercase">{item.scholarship}</td>
                    <td className="p-4 text-xs font-mono text-gray-400 italic">{formatActivityTimestamp(item.date)}</td>
                    <td className="p-4 text-sm font-bold uppercase">{item.status}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-12 pt-8 border-t border-gray-100 flex justify-between items-end">
          <div className="text-left">
            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Authenticated Signature</p>
            <div className="h-10 w-48 border-b-2 border-gray-900/10 mb-2"></div>
            <p className="text-xs font-black text-gray-900">{userName}</p>
            <p className="text-[10px] font-bold text-gray-400">System Administrator</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Page 1 of 1</p>
            <p className="text-[10px] font-bold text-gray-400 italic mt-1">Printed on: {formatDate(printMetadata.date)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}