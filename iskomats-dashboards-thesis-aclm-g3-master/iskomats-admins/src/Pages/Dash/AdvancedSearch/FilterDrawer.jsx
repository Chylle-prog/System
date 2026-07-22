import React from 'react';
import {
  scholarships,
  incomeLabels,
  statusColors,
  gpaBuckets,
  deadlinePresets,
  barangayList,
  schoolList,
  withinDays
} from './data';

const CATEGORIES = [
  {id:"keyword", label:"Scholarship Name"},
  {id:"course", label:"Course / Program"},
  {id:"level", label:"Year Level"},
  {id:"location", label:"Location"},
  {id:"school", label:"School"},
  {id:"type", label:"Type of Scholarship"},
  {id:"gpa", label:"Academic Requirements"},
  {id:"income", label:"Family Income Bracket"},
  {id:"deadline", label:"Application Deadline"},
  {id:"status", label:"Status"},
];

function unique(arr){ return [...new Set(arr)].sort(); }

const facetValues = {
  course: unique(scholarships.map(s=>s.course)),
  level: ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"],
  location: barangayList,
  school: schoolList,
  type: unique(scholarships.map(s=>s.type)),
  income: ["below-100k","100k-250k","250k-500k","above-500k","none"],
  status: ["Open","Pending","Closed","Expired"],
};

export default function FilterDrawer({
  isOpen,
  onClose,
  filters,
  onChangeFilters,
  onResetFilters,
  matchesExcept,
  activeCategory,
  setActiveCategory,
  facetSearchTerms,
  onChangeFacetSearch
}) {
  
  // Helper counting functions
  function countFor(category, value){
    return scholarships.filter(s=>{
      if(!matchesExcept(s, category, filters)) return false;
      if(category==='course') return s.course===value;
      if(category==='level') return s.level===value;
      if(category==='location') return s.location===value;
      if(category==='school') return s.school===value;
      if(category==='type') return s.type===value;
      if(category==='income') return s.income===value;
      if(category==='status') return s.status===value;
      return false;
    }).length;
  }

  function countForGpaBucket(bucket){
    return scholarships.filter(s=> matchesExcept(s,'gpa', filters) && s.gpa>=bucket.min && s.gpa<=bucket.max).length;
  }

  function countForDeadlinePreset(preset){
    return scholarships.filter(s=> matchesExcept(s,'deadline', filters) && preset.test(s.deadline)).length;
  }

  function activeCountInCategory(cat){
    if(cat==='keyword') return filters.keyword ? 1 : 0;
    if(cat==='gpa') return (filters.gpaMin!==null||filters.gpaMax!==null) ? 1 : filters.gpaBuckets.length;
    if(cat==='deadline') return (filters.deadlineFrom||filters.deadlineTo) ? 1 : filters.deadlinePresets.length;
    return filters[cat] ? filters[cat].length : 0;
  }

  const totalActive = CATEGORIES.reduce((sum,c)=>sum+activeCountInCategory(c.id),0);
  const liveResults = scholarships.filter(s => matchesExcept(s, null, filters)).length;

  const handleCheckboxClick = (category, val, disabled) => {
    if (disabled) return;
    const arr = [...filters[category]];
    const idx = arr.indexOf(val);
    if(idx>-1) arr.splice(idx,1); else arr.push(val);
    onChangeFilters({ [category]: arr });
  };

  const handleGpaBucketClick = (id, disabled) => {
    if (disabled) return;
    let arr = [...filters.gpaBuckets];
    const idx = arr.indexOf(id);
    if(idx>-1) arr.splice(idx,1); else arr.push(id);
    onChangeFilters({ gpaBuckets: arr });
  };

  const handleDeadlinePresetClick = (id, disabled) => {
    if (disabled) return;
    let arr = [...filters.deadlinePresets];
    const idx = arr.indexOf(id);
    if(idx>-1) arr.splice(idx,1); else arr.push(id);
    onChangeFilters({ deadlinePresets: arr });
  };

  return (
    <div className={`overlay ${isOpen ? 'open' : ''}`} onClick={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="drawer">
        <div className="drawer-header">
          <div className="drawer-title-wrap">
            <span className="drawer-title">Filters</span>
            {totalActive > 0 && (
              <span className="drawer-count-pill">{totalActive} applied</span>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close drawer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="drawer-body">
          <div className="drawer-nav">
            {CATEGORIES.map(cat => {
              const n = activeCountInCategory(cat.id);
              return (
                <div 
                  key={cat.id} 
                  className={`drawer-nav-item ${cat.id === activeCategory ? 'active' : ''}`}
                  onClick={() => setActiveCategory(cat.id)}
                >
                  <span>{cat.label}</span>
                  {n > 0 && <span className="nav-item-count">{n}</span>}
                </div>
              );
            })}
          </div>

          <div className="drawer-panel">
            {activeCategory === 'keyword' && (
              <>
                <div className="panel-section-title">Scholarship Name</div>
                <input 
                  type="text" 
                  className="keyword-input" 
                  placeholder="e.g. Academic Excellence Grant" 
                  value={filters.keyword}
                  onChange={(e) => onChangeFilters({ keyword: e.target.value })}
                />
                <div className="keyword-hint">Matches any scholarship whose name contains this text.</div>
              </>
            )}

            {['course', 'level', 'location', 'school', 'type', 'income', 'status'].includes(activeCategory) && (() => {
              const category = activeCategory;
              const values = facetValues[category];
              const search = (facetSearchTerms[category] || '').toLowerCase();
              const filteredValues = values.filter(v => v.toLowerCase().includes(search));
              return (
                <>
                  <div className="panel-section-title">{CATEGORIES.find(c=>c.id===category).label}</div>
                  {(values.length > 6 || category === 'course') && (
                    <div className="facet-search">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                        <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input 
                        type="text" 
                        placeholder={`Search ${CATEGORIES.find(c=>c.id===category).label.toLowerCase()}...`}
                        value={facetSearchTerms[category] || ''}
                        onChange={(e) => onChangeFacetSearch(category, e.target.value)}
                      />
                    </div>
                  )}
                  <div className="facet-list">
                    {filteredValues.map(v => {
                      const checked = filters[category].includes(v);
                      const count = countFor(category, v);
                      // Don't disable location, school, or level if count is 0
                      const disabled = category !== 'location' && category !== 'school' && category !== 'level' && count === 0 && !checked;
                      const displayLabel = category === 'income' ? incomeLabels[v] : v;
                      return (
                        <div 
                          key={v} 
                          className={`facet-row ${disabled ? 'disabled' : ''}`}
                          onClick={() => handleCheckboxClick(category, v, disabled)}
                        >
                          <div className={`facet-checkbox ${checked ? 'checked' : ''}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </div>
                          {category === 'status' && (
                            <span className="facet-dot" style={{ backgroundColor: statusColors[v] }}></span>
                          )}
                          <span className="facet-label">{displayLabel}</span>
                          <span className="facet-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            {activeCategory === 'gpa' && (
              <>
                <div className="panel-section-title">Academic Requirements — Minimum GPA</div>
                <div className="range-block">
                  <div className="range-block-label">Preset ranges</div>
                  <div className="facet-list">
                    {gpaBuckets.map(b => {
                      const checked = filters.gpaBuckets.includes(b.id);
                      const count = countForGpaBucket(b);
                      const disabled = count === 0 && !checked;
                      const lockedByCustom = filters.gpaMin !== null || filters.gpaMax !== null;
                      return (
                        <div 
                          key={b.id}
                          className={`facet-row ${disabled || lockedByCustom ? 'disabled' : ''}`}
                          onClick={() => handleGpaBucketClick(b.id, disabled || lockedByCustom)}
                        >
                          <div className={`facet-checkbox ${checked ? 'checked' : ''}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </div>
                          <span className="facet-label">{b.label}</span>
                          <span className="facet-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="divider-text">or set a custom range</div>
                <div className="custom-range-row">
                  <input 
                    type="number" 
                    placeholder="Min e.g. 1.00" 
                    step="0.01" 
                    min="1" 
                    max="5" 
                    value={filters.gpaMin ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : parseFloat(e.target.value);
                      onChangeFilters({
                        gpaMin: val,
                        ...(val !== null ? { gpaBuckets: [] } : {})
                      });
                    }}
                  />
                  <span>to</span>
                  <input 
                    type="number" 
                    placeholder="Max e.g. 5.00" 
                    step="0.01" 
                    min="1" 
                    max="5" 
                    value={filters.gpaMax ?? ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : parseFloat(e.target.value);
                      onChangeFilters({
                        gpaMax: val,
                        ...(val !== null ? { gpaBuckets: [] } : {})
                      });
                    }}
                  />
                </div>
              </>
            )}

            {activeCategory === 'deadline' && (
              <>
                <div className="panel-section-title">Application Deadline</div>
                <div className="range-block">
                  <div className="range-block-label">Quick ranges</div>
                  <div className="facet-list">
                    {deadlinePresets.map(p => {
                      const checked = filters.deadlinePresets.includes(p.id);
                      const count = countForDeadlinePreset(p);
                      const disabled = count === 0 && !checked;
                      const lockedByCustom = filters.deadlineFrom || filters.deadlineTo;
                      return (
                        <div 
                          key={p.id}
                          className={`facet-row ${disabled || lockedByCustom ? 'disabled' : ''}`}
                          onClick={() => handleDeadlinePresetClick(p.id, disabled || lockedByCustom)}
                        >
                          <div className={`facet-checkbox ${checked ? 'checked' : ''}`}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </div>
                          <span className="facet-label">{p.label}</span>
                          <span className="facet-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="divider-text">or pick a custom date range</div>
                <div className="custom-range-row">
                  <input 
                    type="date" 
                    value={filters.deadlineFrom}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChangeFilters({
                        deadlineFrom: val,
                        ...(val ? { deadlinePresets: [] } : {})
                      });
                    }}
                  />
                  <span>to</span>
                  <input 
                    type="date" 
                    value={filters.deadlineTo}
                    onChange={(e) => {
                      const val = e.target.value;
                      onChangeFilters({
                        deadlineTo: val,
                        ...(val ? { deadlinePresets: [] } : {})
                      });
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="drawer-footer">
          <button className="reset-link" onClick={onResetFilters}>Reset all</button>
          <button className="show-results-btn" onClick={onClose}>
            Show {liveResults} result{liveResults === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
