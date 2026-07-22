import './advanced-search.css';
import React, { useState } from 'react';
import {
  scholarships,
  incomeLabels,
  statusColors,
  gpaBuckets,
  deadlinePresets,
  withinDays
} from './data/scholarships';
import FilterDrawer from './FilterDrawer';
import ScholarshipTable from './ScholarshipTable';

const initialFilters = {
  keyword: "",
  course: [],
  level: [],
  location: [],
  school: [],
  type: [],
  income: [],
  status: [],
  gpaBuckets: [],
  gpaMin: null,
  gpaMax: null,
  deadlinePresets: [],
  deadlineFrom: "",
  deadlineTo: ""
};

export default function AdvancedSearch() {
  const [filters, setFilters] = useState(initialFilters);
  const [quickSearch, setQuickSearch] = useState("");
  const [sortBy, setSortBy] = useState("deadline-asc");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("keyword");
  const [facetSearchTerms, setFacetSearchTerms] = useState({});
  const [activeTab, setActiveTab] = useState("scholarships");

  const changeFilters = (newValues) => {
    setFilters(prev => ({ ...prev, ...newValues }));
  };

  const resetFilters = () => {
    setFilters(initialFilters);
    setFacetSearchTerms({});
  };

  // Match logic React implementation
  const matchesExcept = (s, exceptCategory, currentFilters) => {
    const f = currentFilters;
    
    // Quick search logic
    if (quickSearch) {
      const qs = quickSearch.toLowerCase();
      if (!(s.name.toLowerCase().includes(qs) || s.provider.toLowerCase().includes(qs))) {
        return false;
      }
    }

    if (exceptCategory !== 'keyword' && f.keyword) {
      if (!s.name.toLowerCase().includes(f.keyword.toLowerCase())) return false;
    }
    if (exceptCategory !== 'course' && f.course.length && !f.course.includes(s.course)) return false;
    if (exceptCategory !== 'level' && f.level.length && !f.level.includes(s.level)) return false;
    if (exceptCategory !== 'location' && f.location.length && !f.location.includes(s.location)) return false;
    if (exceptCategory !== 'school' && f.school.length && !f.school.includes(s.school)) return false;
    if (exceptCategory !== 'type' && f.type.length && !f.type.includes(s.type)) return false;
    if (exceptCategory !== 'income' && f.income.length && !f.income.includes(s.income)) return false;
    if (exceptCategory !== 'status' && f.status.length && !f.status.includes(s.status)) return false;

    if (exceptCategory !== 'gpa') {
      if (f.gpaMin !== null && s.gpa < f.gpaMin) return false;
      if (f.gpaMax !== null && s.gpa > f.gpaMax) return false;
      if (f.gpaMin === null && f.gpaMax === null && f.gpaBuckets.length) {
        const inAny = f.gpaBuckets.some(bid => {
          const b = gpaBuckets.find(x => x.id === bid);
          return s.gpa >= b.min && s.gpa <= b.max;
        });
        if (!inAny) return false;
      }
    }

    if (exceptCategory !== 'deadline') {
      if (f.deadlineFrom && s.deadline < f.deadlineFrom) return false;
      if (f.deadlineTo && s.deadline > f.deadlineTo) return false;
      if (!f.deadlineFrom && !f.deadlineTo && f.deadlinePresets.length) {
        const inAny = f.deadlinePresets.some(pid => {
          const p = deadlinePresets.find(x => x.id === pid);
          return p.test(s.deadline);
        });
        if (!inAny) return false;
      }
    }

    return true;
  };

  const matches = (s) => matchesExcept(s, null, filters);

  const getFilteredAndSorted = () => {
    const list = scholarships.filter(matches);
    if (sortBy === 'deadline-asc') list.sort((a, b) => a.deadline.localeCompare(b.deadline));
    if (sortBy === 'deadline-desc') list.sort((a, b) => b.deadline.localeCompare(a.deadline));
    if (sortBy === 'name-asc') list.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === 'status') list.sort((a, b) => a.status.localeCompare(b.status));
    return list;
  };

  const filteredScholarships = getFilteredAndSorted();

  // Badge count for drawer button
  const activeCountInCategory = (cat) => {
    if (cat === 'keyword') return filters.keyword ? 1 : 0;
    if (cat === 'gpa') return (filters.gpaMin !== null || filters.gpaMax !== null) ? 1 : filters.gpaBuckets.length;
    if (cat === 'deadline') return (filters.deadlineFrom || filters.deadlineTo) ? 1 : filters.deadlinePresets.length;
    return filters[cat] ? filters[cat].length : 0;
  };

  const totalActiveCount = () => {
    const categories = ['keyword', 'course', 'level', 'location', 'school', 'type', 'income', 'deadline', 'gpa', 'status'];
    return categories.reduce((sum, c) => sum + activeCountInCategory(c), 0);
  };

  const totalActive = totalActiveCount() + (quickSearch ? 1 : 0);

  // Chip definitions
  const getChips = () => {
    const chips = [];
    if (quickSearch) {
      chips.push({
        label: `"${quickSearch}"`,
        remove: () => setQuickSearch("")
      });
    }
    if (filters.keyword) {
      chips.push({
        label: `Name: ${filters.keyword}`,
        remove: () => changeFilters({ keyword: "" })
      });
    }
    const standardCategories = [
      { key: 'course', label: 'Course' },
      { key: 'level', label: 'Year Level' },
      { key: 'location', label: 'Location' },
      { key: 'school', label: 'School' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' }
    ];
    standardCategories.forEach(cat => {
      filters[cat.key].forEach(v => {
        chips.push({
          label: `${cat.label}: ${v}`,
          remove: () => changeFilters({ [cat.key]: filters[cat.key].filter(x => x !== v) })
        });
      });
    });
    filters.income.forEach(v => {
      chips.push({
        label: `Income: ${incomeLabels[v]}`,
        remove: () => changeFilters({ income: filters.income.filter(x => x !== v) })
      });
    });
    if (filters.gpaMin !== null || filters.gpaMax !== null) {
      chips.push({
        label: `GPA: ${filters.gpaMin ?? '—'} to ${filters.gpaMax ?? '—'}`,
        remove: () => changeFilters({ gpaMin: null, gpaMax: null })
      });
    }
    filters.gpaBuckets.forEach(bid => {
      const b = gpaBuckets.find(x => x.id === bid);
      if (b) {
        chips.push({
          label: `GPA: ${b.label}`,
          remove: () => changeFilters({ gpaBuckets: filters.gpaBuckets.filter(x => x !== bid) })
        });
      }
    });
    if (filters.deadlineFrom || filters.deadlineTo) {
      chips.push({
        label: `Deadline: ${filters.deadlineFrom || '…'} → ${filters.deadlineTo || '…'}`,
        remove: () => changeFilters({ deadlineFrom: "", deadlineTo: "" })
      });
    }
    filters.deadlinePresets.forEach(pid => {
      const p = deadlinePresets.find(x => x.id === pid);
      if (p) {
        chips.push({
          label: `Deadline: ${p.label}`,
          remove: () => changeFilters({ deadlinePresets: filters.deadlinePresets.filter(x => x !== pid) })
        });
      }
    });
    return chips;
  };

  const chips = getChips();

    return (
    <div className="advanced-search-container bg-gray-50/50 rounded-3xl p-6 min-h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight uppercase">Search Scholarships</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">Database-backed advanced scholarship search</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-[#800020] text-white text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-[#650018] transition-colors shadow-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          NEW SCHOLARSHIP
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-6">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl flex-1 max-w-xl focus-within:border-[#800020] focus-within:ring-1 focus-within:ring-[#800020]/20 transition-all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400">
              <circle cx="11" cy="11" r="7"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input 
              type="text" 
              placeholder="Search by scholarship name, provider, or ID..."
              value={quickSearch}
              onChange={(e) => setQuickSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium w-full text-gray-700 placeholder-gray-400"
            />
          </div>
          
          <button 
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-gray-200 transition-colors"
            onClick={() => setIsDrawerOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <line x1="4" y1="6" x2="20" y2="6"/>
              <circle cx="9" cy="6" r="2" fill="currentColor"/>
              <line x1="4" y1="12" x2="20" y2="12"/>
              <circle cx="16" cy="12" r="2" fill="currentColor"/>
              <line x1="4" y1="18" x2="20" y2="18"/>
              <circle cx="11" cy="18" r="2" fill="currentColor"/>
            </svg>
            Advanced Filters
            {totalActive > 0 && (
              <span className="bg-[#800020] text-white px-2 py-0.5 rounded-full text-[10px] ml-1">{totalActive}</span>
            )}
          </button>
        </div>
        
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
            {chips.map((chip, i) => (
              <div key={i} className="flex items-center gap-2 bg-[#800020]/10 text-[#800020] px-3 py-1.5 rounded-lg text-xs font-bold">
                {chip.label}
                <button aria-label="remove" onClick={chip.remove} className="hover:text-red-700 ml-1">?</button>
              </div>
            ))}
            {chips.length > 1 && (
              <button className="text-xs font-bold text-gray-500 hover:text-gray-700 hover:underline px-2" onClick={resetFilters}>
                Clear all
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between items-center mb-4 px-2">
        <div className="text-sm font-medium text-gray-600">
          <b className="text-gray-900">{filteredScholarships.length}</b> scholarship{filteredScholarships.length === 1 ? '' : 's'} found
        </div>
        <div className="flex items-center gap-2 text-sm font-medium text-gray-600">
          Sort by
          <select 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1 text-sm outline-none focus:border-[#800020]"
          >
            <option value="deadline-asc">Deadline (soonest)</option>
            <option value="deadline-desc">Deadline (latest)</option>
            <option value="name-asc">Name (A�Z)</option>
            <option value="status">Status</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-4 p-4 bg-gray-50 border-b border-gray-100 text-xs font-black text-gray-500 uppercase tracking-widest">
              <span>Scholarship</span>
              <span>Location</span>
              <span>Status</span>
              <span>Deadline</span>
              <span className="text-right">Control</span>
            </div>
            <div className="divide-y divide-gray-50">
              <ScholarshipTable list={filteredScholarships} />
            </div>
          </div>
        </div>
      </div>

      <FilterDrawer 
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        filters={filters}
        onChangeFilters={changeFilters}
        onResetFilters={resetFilters}
        matchesExcept={matchesExcept}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        facetSearchTerms={facetSearchTerms}
        onChangeFacetSearch={(cat, term) => setFacetSearchTerms(prev => ({ ...prev, [cat]: term }))}
      />
    </div>
  );
}


