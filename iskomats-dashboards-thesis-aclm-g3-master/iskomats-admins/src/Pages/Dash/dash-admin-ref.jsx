import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FaGlobeAfrica, FaUserGraduate, FaHandsHelping, FaTachometerAlt, FaChevronDown,
  FaSignInAlt, FaSignOutAlt, FaKey, FaUser, FaClock, FaCheckCircle, FaTimesCircle,
  FaFilter, FaSearch, FaUsersCog, FaChartBar, FaUserShield, FaEdit, FaTrash, FaBan, FaUnlock, FaPrint, FaPlus,
  FaHeadset, FaTicketAlt, FaExclamationCircle, FaUserTie, FaUserEdit, FaFileExcel, FaFilePdf, FaFileCsv, FaTimes
} from 'react-icons/fa';
import * as XLSX from 'xlsx';

export default function Dash() {
  const navigate = useNavigate();
  const [submenus, setSubmenus] = useState({ reports: false });
  const [activeTab, setActiveTab] = useState('dashboard');
  const userRole = localStorage.getItem('userRole') || 'admin';
  const userName = localStorage.getItem('userName') || 'Admin';
  const userFirstName = localStorage.getItem('userFirstName') || 'Admin';

  // Modal & Form States
  const [accountModal, setAccountModal] = useState({ open: false, mode: 'add', data: null });
  const [reportModal, setReportModal] = useState({ open: false });
  const [confirmModal, setConfirmModal] = useState({ open: false, type: '', targetId: null, message: '', action: null });

  // Filter States
  const [accountScholarship, setAccountScholarship] = useState('All');
  const [accountType, setAccountType] = useState('Admin'); // For management tab
  const [accountSearch, setAccountSearch] = useState(''); // For management tab

  // Report Specific Filter States
  const [accReportFilter, setAccReportFilter] = useState({ program: 'All', role: 'All', search: '' });
  const [actReportFilter, setActReportFilter] = useState({ program: 'All', action: 'All', search: '' });

  // Report Form State
  const [reportForm, setReportForm] = useState({
    type: 'Accounts',
    startDate: '',
    endDate: '',
    program: 'All',
    role: 'All',
    format: 'Excel'
  });

  // Print-specific States
  const [printData, setPrintData] = useState([]);
  const [printMetadata, setPrintMetadata] = useState({ title: '', subtitle: '', date: '' });

  // Form Field States (Accounts)
  const [accountForm, setAccountForm] = useState({
    fullName: '', email: '', username: '', password: '', role: 'Scholar', status: 'Active'
  });

  // Mock Data
  const [activities] = useState({
    africa: [
      { id: 1, user: 'Ana Arriola', activity: 'Login', date: '2026-02-17 09:30', status: 'success', icon: <FaSignInAlt />, scholarship: 'Africa' },
      { id: 2, user: 'Angela Cacao', activity: 'Change Password', date: '2026-02-17 10:15', status: 'success', icon: <FaKey />, scholarship: 'Africa' },
      { id: 3, user: 'Mikaela Lantafe', activity: 'Logout', date: '2026-02-17 11:45', status: 'success', icon: <FaSignOutAlt />, scholarship: 'Africa' },
      { id: 4, user: 'Ana Arriola', activity: 'Profile Update', date: '2026-02-17 14:20', status: 'success', icon: <FaUser />, scholarship: 'Africa' },
      { id: 11, user: 'John Doe', activity: 'Login Failed', date: '2026-02-17 15:30', status: 'failed', icon: <FaTimesCircle />, scholarship: 'Africa' },
    ],
    vilma: [
      { id: 5, user: 'Jashia Deveza', activity: 'Login', date: '2026-02-17 08:45', status: 'success', icon: <FaSignInAlt />, scholarship: 'Vilma' },
      { id: 6, user: 'Abeth Andal', activity: 'Change Password', date: '2026-02-17 09:30', status: 'success', icon: <FaKey />, scholarship: 'Vilma' },
      { id: 7, user: 'Jashia Deveza', activity: 'Logout', date: '2026-02-17 12:00', status: 'success', icon: <FaSignOutAlt />, scholarship: 'Vilma' },
      { id: 12, user: 'Jane Smith', activity: 'Password Reset', date: '2026-02-17 13:15', status: 'pending', icon: <FaClock />, scholarship: 'Vilma' },
    ],
    tulong: [
      { id: 8, user: 'Kurt Yermo', activity: 'Login', date: '2026-02-17 07:30', status: 'success', icon: <FaSignInAlt />, scholarship: 'Tulong' },
      { id: 9, user: 'Raven Belen', activity: 'Profile Update', date: '2026-02-17 10:45', status: 'success', icon: <FaUser />, scholarship: 'Tulong' },
      { id: 10, user: 'Kurt Yermo', activity: 'Logout', date: '2026-02-17 13:15', status: 'success', icon: <FaSignOutAlt />, scholarship: 'Tulong' },
      { id: 13, user: 'Mark Johnson', activity: 'Account Locked', date: '2026-02-17 16:00', status: 'failed', icon: <FaTimesCircle />, scholarship: 'Tulong' },
    ]
  });

  const [accounts, setAccounts] = useState([
    { id: 1, name: 'Main Admin', email: 'admin@iskomats.com', role: 'admin', scholarship: 'All', type: 'Admin', status: 'active', joined: '2025-01-10' },
    { id: 2, name: 'Africa Admin', email: 'africa@iskomats.com', role: 'africa', scholarship: 'Africa', type: 'Admin', status: 'active', joined: '2025-02-05' },
    { id: 3, name: 'Vilma Admin', email: 'vilma@iskomats.com', role: 'vilma', scholarship: 'Vilma', type: 'Admin', status: 'active', joined: '2025-02-12' },
    { id: 4, name: 'Tulong Admin', email: 'tulong@iskomats.com', role: 'tulong', scholarship: 'Tulong', type: 'Admin', status: 'active', joined: '2025-02-20' },
    { id: 5, name: 'Ana Arriola', email: 'ana.arriola@example.com', role: 'user', scholarship: 'Africa', type: 'Applicant', status: 'active', joined: '2026-03-01' },
    { id: 6, name: 'Angela Cacao', email: 'angela.cacao@example.com', role: 'user', scholarship: 'Africa', type: 'Applicant', status: 'active', joined: '2026-03-02' },
    { id: 7, name: 'Jashia Deveza', email: 'jashia.deveza@example.com', role: 'user', scholarship: 'Vilma', type: 'Applicant', status: 'active', joined: '2026-03-03' },
    { id: 8, name: 'Kurt Yermo', email: 'kurt.yermo@example.com', role: 'user', scholarship: 'Tulong', type: 'Applicant', status: 'active', joined: '2026-03-04' },
    { id: 9, name: 'Test User', email: 'test@example.com', role: 'user', scholarship: 'All', type: 'Applicant', status: 'suspended', joined: '2026-01-15' },
  ]);

  const allActivities = useMemo(() => {
    return [...activities.africa, ...activities.vilma, ...activities.tulong];
  }, [activities]);

  // Filtered Data for Reports
  const filteredAccountReport = useMemo(() => {
    return accounts.filter(acc => {
      const matchProgram = accReportFilter.program === 'All' || acc.scholarship === accReportFilter.program;
      const matchRole = accReportFilter.role === 'All' || acc.role === accReportFilter.role.toLowerCase();
      const matchSearch = acc.name.toLowerCase().includes(accReportFilter.search.toLowerCase()) ||
        acc.email.toLowerCase().includes(accReportFilter.search.toLowerCase());
      return matchProgram && matchRole && matchSearch;
    });
  }, [accounts, accReportFilter]);

  const filteredActivityReport = useMemo(() => {
    return allActivities.filter(log => {
      const matchProgram = actReportFilter.program === 'All' || log.scholarship === actReportFilter.program;
      const matchAction = actReportFilter.action === 'All' || log.activity.toLowerCase().includes(actReportFilter.action.toLowerCase());
      const matchSearch = log.user.toLowerCase().includes(actReportFilter.search.toLowerCase()) ||
        log.activity.toLowerCase().includes(actReportFilter.search.toLowerCase());
      return matchProgram && matchAction && matchSearch;
    });
  }, [allActivities, actReportFilter]);

  // Actions
  const toggleSubmenu = (menu) => setSubmenus(prev => ({ ...prev, [menu]: !prev[menu] }));

  const openAccountModal = (mode, data = null) => {
    setAccountModal({ open: true, mode, data });
    if (mode === 'edit' && data) {
      setAccountForm({
        fullName: data.name, email: data.email, username: data.username || '', password: '',
        role: data.role === 'admin' ? 'Admin' : 'Scholar',
        status: data.status === 'active' ? 'Active' : 'Inactive'
      });
    } else {
      setAccountForm({ fullName: '', email: '', username: '', password: '', role: 'Scholar', status: 'Active' });
    }
  };

  const handleAccountSubmit = (e) => {
    e.preventDefault();
    if (accountModal.mode === 'add') {
      const newAcc = {
        id: accounts.length + 1, name: accountForm.fullName, email: accountForm.email,
        username: accountForm.username, role: accountForm.role.toLowerCase(),
        type: accountForm.role === 'Admin' ? 'Admin' : 'Applicant',
        status: accountForm.status.toLowerCase(), joined: new Date().toISOString().split('T')[0]
      };
      setAccounts([...accounts, newAcc]);
    } else {
      setAccounts(accounts.map(acc => acc.id === accountModal.data.id ? {
        ...acc, name: accountForm.fullName, email: accountForm.email, username: accountForm.username,
        role: accountForm.role.toLowerCase(), status: accountForm.status.toLowerCase(),
      } : acc));
    }
    setAccountModal({ open: false });
  };

  const requestDeleteAccount = (id) => {
    setConfirmModal({
      open: true, type: 'Delete', targetId: id, message: 'Are you sure you want to delete this account?',
      action: () => { setAccounts(accounts.filter(acc => acc.id !== id)); setConfirmModal({ open: false }); }
    });
  };

  const requestDeactivateAccount = (acc) => {
    const isActivating = acc.status !== 'active';
    setConfirmModal({
      open: true, type: isActivating ? 'Activate' : 'Deactivate', targetId: acc.id,
      message: `Are you sure you want to ${isActivating ? 'activate' : 'deactivate'} this account?`,
      action: () => {
        setAccounts(accounts.map(a => a.id === acc.id ? { ...a, status: isActivating ? 'active' : 'suspended' } : a));
        setConfirmModal({ open: false });
      }
    });
  };

  const exportToExcel = (data, filename) => {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${filename}.xlsx`);
  };

  const handleGenerateReport = (e) => {
    e.preventDefault();
    let data = [];
    if (reportForm.type === 'Accounts') data = accounts;
    else data = allActivities;

    if (reportForm.program !== 'All') {
      data = data.filter(item => (item.scholarship || item.program) === reportForm.program);
    }

    if (reportForm.format === 'Excel') {
      exportToExcel(data, `${reportForm.type}_Report_${new Date().toISOString().split('T')[0]}`);
    } else if (reportForm.format === 'PDF') {
      setPrintData(data);
      setPrintMetadata({
        title: `${reportForm.type} Report`,
        subtitle: `Program: ${reportForm.program} | Date: ${new Date().toLocaleDateString()}`,
        date: new Date().toLocaleString()
      });
      setReportModal({ open: false });
      // Small timeout to allow state to update before print dialog
      setTimeout(() => {
        window.print();
      }, 500);
    } else {
      alert(`Generating ${reportForm.format} report for ${reportForm.type}... (Mock)`);
    }
  };

  const getActivityIcon = (status) => {
    switch (status) {
      case 'success': return <FaCheckCircle className="text-green-600" />;
      case 'pending': return <FaClock className="text-yellow-600" />;
      case 'failed': return <FaTimesCircle className="text-red-600" />;
      default: return <FaClock className="text-gray-600" />;
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-gray-50 to-blue-50/30 pt-20">
      {/* Sidebar */}
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
        <div className="p-4 border-t border-white/10">
          <button onClick={() => setReportModal({ open: true })} className="w-full py-3 bg-white text-[#800020] font-black rounded-xl shadow-lg hover:bg-gray-100 transition-all flex items-center justify-center gap-2">
            <FaPrint /> Generate Report
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        <header className="bg-white rounded-2xl shadow-sm px-8 py-5 mb-8 flex items-center justify-between border border-gray-100">
          <div>
            <h1 className="text-2xl font-black text-[#800020] tracking-tight uppercase">
              {activeTab.replace('-', ' ')}
            </h1>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Administrator Control Panel</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-black text-gray-900">{userName}</p>
              <p className="text-[10px] font-bold text-green-600 uppercase">System Online</p>
            </div>
            <div className="w-10 h-10 rounded-full bg-[#800020] flex items-center justify-center text-white font-black">
              {userName.charAt(0)}
            </div>
          </div>
        </header>

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[
                { label: 'Total Scholars', value: accounts.filter(a => a.type === 'Applicant').length, icon: <FaUserGraduate />, color: '#800020' },
                { label: 'System Uptime', value: '99.9%', icon: <FaCheckCircle />, color: '#16a34a' },
                { label: 'Audit Logs', value: allActivities.length, icon: <FaClock />, color: '#d97706' }
              ].map((kpi, i) => (
                <div key={i} className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 hover:shadow-md transition-all">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-3 rounded-2xl" style={{ backgroundColor: `${kpi.color}15`, color: kpi.color }}>{kpi.icon}</div>
                    <span className="text-[10px] font-black text-green-600 bg-green-50 px-2 py-1 rounded-md">LIVE</span>
                  </div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{kpi.label}</p>
                  <h3 className="text-3xl font-black text-gray-900 mt-1">{kpi.value}</h3>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex justify-between items-center bg-gray-50/30">
                  <h3 className="font-black text-gray-900 uppercase tracking-widest text-xs">System Activity Stream</h3>
                  <button onClick={() => setActiveTab('activity-reports')} className="text-xs font-bold text-[#800020] hover:underline">Full Audit</button>
                </div>
                <div className="divide-y divide-gray-50">
                  {allActivities.slice(0, 6).map(act => (
                    <div key={act.id} className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center text-white ${act.status === 'success' ? 'bg-green-500' : 'bg-red-500'}`}>{act.icon}</div>
                      <div className="flex-1">
                        <div className="flex justify-between items-center mb-0.5">
                          <span className="text-sm font-black text-gray-900">{act.user}</span>
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{act.date}</span>
                        </div>
                        <p className="text-xs text-gray-500">{act.activity} - <span className="text-[#800020] font-bold">{act.scholarship}</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-8">
                <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                  <h4 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-6 border-l-4 border-[#800020] pl-4">Regional Distribution</h4>
                  <div className="space-y-6">
                    {['Africa', 'Vilma', 'Tulong'].map(sch => {
                      const count = accounts.filter(a => a.scholarship === sch).length;
                      const pct = (count / accounts.length) * 100;
                      return (
                        <div key={sch} className="space-y-2">
                          <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-gray-500">
                            <span>{sch}</span>
                            <span>{count} Users</span>
                          </div>
                          <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                            <div className="bg-[#800020] h-full rounded-full" style={{ width: `${pct}%` }}></div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'manage-accounts' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex bg-gray-100 p-1 rounded-2xl">
                {['Admin', 'Applicant'].map(t => (
                  <button key={t} onClick={() => setAccountType(t)} className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${accountType === t ? 'bg-white text-[#800020] shadow-sm' : 'text-gray-500 hover:bg-white/50'}`}>{t}s</button>
                ))}
              </div>
              <button onClick={() => openAccountModal('add')} className="px-6 py-2 bg-[#800020] text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-[#800020]/20 flex items-center gap-2 hover:bg-[#650018] transition-all">
                <FaPlus /> New {accountType}
              </button>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-6 border-b border-gray-50 flex items-center gap-4">
                <div className="relative flex-1">
                  <FaSearch className="absolute left-4 top-3.5 text-gray-300" />
                  <input value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} type="text" placeholder="Search by name, email, or ID..." className="w-full pl-12 pr-4 py-3 bg-gray-50 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#800020]" />
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
                  {accounts.filter(a => a.type === accountType && (a.name.toLowerCase().includes(accountSearch.toLowerCase()) || a.email.toLowerCase().includes(accountSearch.toLowerCase()))).map(acc => (
                    <tr key={acc.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-8 py-5">
                        <p className="font-black text-gray-900">{acc.name}</p>
                        <p className="text-xs text-gray-400">{acc.email}</p>
                      </td>
                      <td className="px-8 py-5">
                        <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-gray-100 bg-gray-50 text-gray-600">{acc.scholarship}</span>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${acc.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${acc.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{acc.status}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-xs text-gray-400 font-mono">{acc.joined}</td>
                      <td className="px-8 py-5 text-right space-x-2">
                        <button onClick={() => openAccountModal('edit', acc)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-all"><FaUserEdit /></button>
                        <button onClick={() => requestDeactivateAccount(acc)} className={`p-2 rounded-lg transition-all ${acc.status === 'active' ? 'text-amber-600 hover:bg-amber-50' : 'text-green-600 hover:bg-green-50'}`}>{acc.status === 'active' ? <FaBan /> : <FaUnlock />}</button>
                        <button onClick={() => requestDeleteAccount(acc.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"><FaTrash /></button>
                      </td>
                    </tr>
                  ))}
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
                  <input
                    value={accReportFilter.search}
                    onChange={e => setAccReportFilter({ ...accReportFilter, search: e.target.value })}
                    placeholder="Search accounts..."
                    className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                  />
                </div>
                <select
                  value={accReportFilter.program}
                  onChange={e => setAccReportFilter({ ...accReportFilter, program: e.target.value })}
                  className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                >
                  <option value="All">All Programs</option>
                  <option value="Africa">Africa</option>
                  <option value="Vilma">Vilma</option>
                  <option value="Tulong">Tulong</option>
                </select>
                <select
                  value={accReportFilter.role}
                  onChange={e => setAccReportFilter({ ...accReportFilter, role: e.target.value })}
                  className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                >
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
                  {filteredAccountReport.map(acc => (
                    <tr key={acc.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-8 py-5">
                        <p className="font-black text-gray-900">{acc.name}</p>
                        <p className="text-xs text-gray-400">{acc.email}</p>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest ${acc.role === 'admin' ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}`}>
                          {acc.role}
                        </span>
                      </td>
                      <td className="px-8 py-5 font-bold text-gray-600">{acc.scholarship}</td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${acc.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></span>
                          <span className={`text-[10px] font-black uppercase tracking-widest ${acc.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{acc.status}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-xs text-gray-400 font-mono">{acc.joined}</td>
                    </tr>
                  ))}
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
                  <input
                    value={actReportFilter.search}
                    onChange={e => setActReportFilter({ ...actReportFilter, search: e.target.value })}
                    placeholder="Search logs..."
                    className="pl-8 pr-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                  />
                </div>
                <select
                  value={actReportFilter.program}
                  onChange={e => setActReportFilter({ ...actReportFilter, program: e.target.value })}
                  className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                >
                  <option value="All">All Programs</option>
                  <option value="Africa">Africa</option>
                  <option value="Vilma">Vilma</option>
                  <option value="Tulong">Tulong</option>
                </select>
                <select
                  value={actReportFilter.action}
                  onChange={e => setActReportFilter({ ...actReportFilter, action: e.target.value })}
                  className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-[10px] font-black uppercase outline-none focus:ring-2 focus:ring-[#800020]"
                >
                  <option value="All">All Actions</option>
                  <option value="Login">Login</option>
                  <option value="Logout">Logout</option>
                  <option value="Password">Password / Security</option>
                  <option value="Profile">Profile Updates</option>
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
                    {filteredActivityReport.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-8 py-4 font-black text-gray-900">{log.user}</td>
                        <td className="px-8 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[#800020] opacity-30">{log.icon}</span>
                            <span className="font-bold text-gray-600">{log.activity}</span>
                          </div>
                        </td>
                        <td className="px-8 py-4">
                          <span className="text-[10px] font-black text-[#800020] border border-[#800020]/20 px-2 py-0.5 rounded uppercase tracking-widest">{log.scholarship}</span>
                        </td>
                        <td className="px-8 py-4 font-mono text-xs text-gray-400 italic">{log.date}</td>
                        <td className="px-8 py-4 text-center">
                          <div className="flex justify-center">{getActivityIcon(log.status)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MODALS */}
      {accountModal.open && (
        <div className="fixed inset-0 bg-[#800020]/20 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-md overflow-hidden shadow-2xl border border-white/50 animate-in fade-in zoom-in duration-300">
            <div className="bg-gradient-to-r from-[#800020] to-[#650018] p-8 text-white relative">
              <FaUsersCog className="absolute -top-4 -right-4 text-8xl opacity-10 rotate-12" />
              <h3 className="text-2xl font-black uppercase tracking-tighter">{accountModal.mode === 'add' ? 'Create Account' : 'Edit Account'}</h3>
              <p className="text-xs font-bold opacity-70 uppercase tracking-widest mt-1">Iscomats Identity Access</p>
            </div>
            <form onSubmit={handleAccountSubmit} className="p-8 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Legal Full Name</label>
                  <input required value={accountForm.fullName} onChange={e => setAccountForm({ ...accountForm, fullName: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black focus:ring-2 focus:ring-[#800020] outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Email Address</label>
                    <input required type="email" value={accountForm.email} onChange={e => setAccountForm({ ...accountForm, email: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black focus:ring-2 focus:ring-[#800020] outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Username</label>
                    <input required value={accountForm.username} onChange={e => setAccountForm({ ...accountForm, username: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black focus:ring-2 focus:ring-[#800020] outline-none" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">System Role</label>
                    <select value={accountForm.role} onChange={e => setAccountForm({ ...accountForm, role: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black focus:ring-2 focus:ring-[#800020] outline-none">
                      <option value="Admin">Admin</option>
                      <option value="Scholar">Scholar</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-1">Access Status</label>
                    <select value={accountForm.status} onChange={e => setAccountForm({ ...accountForm, status: e.target.value })} className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-black focus:ring-2 focus:ring-[#800020] outline-none">
                      <option value="Active">Active</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setAccountModal({ open: false })} className="flex-1 py-4 font-black text-gray-400 hover:bg-gray-50 rounded-2xl transition-all uppercase text-xs tracking-widest">Cancel</button>
                <button type="submit" className="flex-1 py-4 bg-[#800020] text-white font-black rounded-2xl shadow-xl shadow-[#800020]/20 hover:bg-[#650018] transition-all uppercase text-xs tracking-widest">Confirm</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {reportModal.open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl border border-white/20 animate-in zoom-in duration-300">
            <div className="bg-gradient-to-br from-gray-900 to-black p-10 text-white relative">
              <FaChartBar className="absolute -top-6 -right-6 text-[160px] opacity-10 rotate-12" />
              <h3 className="text-3xl font-black uppercase tracking-tighter leading-none">Intelligence<br />Reports</h3>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-[4px] mt-4">Synthetic Data Export Engine</p>
            </div>
            <form onSubmit={handleGenerateReport} className="p-10 space-y-8">
              <div className="grid grid-cols-2 gap-6">
                <div className="col-span-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Target Data Module</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Accounts', 'Activities'].map(t => (
                      <button type="button" key={t} onClick={() => setReportForm({ ...reportForm, type: t })} className={`py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${reportForm.type === t ? 'bg-[#800020] text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>{t}</button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2 grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Temporal Start</label>
                    <input type="date" className="w-full p-4 bg-gray-50 border-none rounded-2xl text-xs font-black focus:ring-2 focus:ring-[#800020]" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Temporal End</label>
                    <input type="date" className="w-full p-4 bg-gray-50 border-none rounded-2xl text-xs font-black focus:ring-2 focus:ring-[#800020]" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Program Filter</label>
                  <select value={reportForm.program} onChange={e => setReportForm({ ...reportForm, program: e.target.value })} className="w-full p-4 bg-gray-50 border-none rounded-2xl text-xs font-black focus:ring-2 focus:ring-[#800020] outline-none">
                    <option value="All">All Programs</option>
                    <option value="Africa">Africa</option>
                    <option value="Vilma">Vilma</option>
                    <option value="Tulong">Tulong</option>
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
          <div className="bg-white rounded-[40px] p-12 max-w-sm w-full text-center shadow-2xl border border-white/20">
            <div className={`w-28 h-28 rounded-full mx-auto flex items-center justify-center mb-8 ${confirmModal.type === 'Delete' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
              <FaExclamationCircle className="text-5xl animate-bounce" />
            </div>
            <h3 className="text-3xl font-black text-gray-900 mb-2 uppercase tracking-tighter">{confirmModal.type} System?</h3>
            <p className="text-gray-400 text-sm font-bold leading-relaxed mb-10">{confirmModal.message}</p>
            <div className="flex flex-col gap-3">
              <button onClick={confirmModal.action} className={`w-full py-5 text-white font-black rounded-3xl shadow-xl transition-all uppercase text-xs tracking-widest ${confirmModal.type === 'Delete' ? 'bg-red-600 shadow-red-600/20 hover:bg-red-700' : 'bg-amber-600 shadow-amber-600/20 hover:bg-amber-700'}`}>Yes, Execute</button>
              <button onClick={() => setConfirmModal({ open: false })} className="w-full py-5 font-black text-gray-400 hover:bg-gray-50 rounded-3xl transition-all uppercase text-xs tracking-widest">Abort Mission</button>
            </div>
          </div>
        </div>
      )}

      {/* PRINT ONLY SECTION */}
      <div className="print-only p-8 bg-white min-h-screen w-full">
        <div className="report-header mb-8 text-center border-b-4 border-[#800020] pb-6">
          <h1 className="report-title text-4xl font-black text-[#800020] uppercase tracking-tighter">{printMetadata.title}</h1>
          <p className="report-subtitle text-lg text-gray-500 font-bold mt-2">{printMetadata.subtitle}</p>
          <p className="text-[10px] text-gray-400 uppercase tracking-widest mt-4">Generated via Iskomats Admin Intelligence Engine</p>
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
            {printData.map((item, idx) => (
              <tr key={item.id || idx} className="border-b border-gray-100">
                {reportForm.type === 'Accounts' ? (
                  <>
                    <td className="p-4 text-sm font-bold text-gray-900">#ACC-{item.id}</td>
                    <td className="p-4 text-sm font-bold text-gray-700">{item.fullName}</td>
                    <td className="p-4 text-sm text-gray-500">{item.email}</td>
                    <td className="p-4 text-sm font-black text-[#800020] uppercase">{item.role}</td>
                    <td className="p-4 text-sm font-bold">
                      <span className={item.status === 'active' ? 'text-green-600' : 'text-amber-600'}>
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="p-4 text-sm font-bold text-gray-900">{item.user}</td>
                    <td className="p-4 text-sm font-bold text-gray-700">{item.activity}</td>
                    <td className="p-4 text-sm font-black text-[#800020] uppercase">{item.scholarship}</td>
                    <td className="p-4 text-xs font-mono text-gray-400 italic">{item.date}</td>
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
            <p className="text-[10px] font-bold text-gray-400 italic mt-1">Printed on: {printMetadata.date}</p>
          </div>
        </div>
      </div>

    </div>
  );
}
