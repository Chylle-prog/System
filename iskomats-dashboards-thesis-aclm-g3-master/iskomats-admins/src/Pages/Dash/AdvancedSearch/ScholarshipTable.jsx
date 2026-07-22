import React from 'react';

function statusClass(s) {
  return 'status-' + s.toLowerCase();
}

function formatDate(d) {
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ScholarshipTable({ list }) {
  if (list.length === 0) {
    return (
      <div className="empty-row">No scholarships matched your filters.</div>
    );
  }

  return (
    <>
      {list.map((s, idx) => (
        <div key={`${(s.scholarshipName || 'Untitled')}-${idx}`} className="table-row">
          <div>
            <div className="row-title">{(s.scholarshipName || 'Untitled')}</div>
            <div className="row-meta">
              <span>{(s.providerName || 'Current Provider')}</span>
              <span>{(s.level || 'All Levels')}</span>
              <span>{(s.course || 'All Courses')}</span>
            </div>
          </div>
          <div className="col-loc" style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
            {s.location}
          </div>
          <div>
            <span className={`status-badge ${statusClass((s.isFull ? 'Full' : 'Open'))}`}>
              {(s.isFull ? 'Full' : 'Open')}
            </span>
          </div>
          <div className="col-deadline deadline-cell">{formatDate(s.deadline)}</div>
          <div className="control-cell">
            <button className="control-btn">View Applicants</button>
          </div>
        </div>
      ))}
    </>
  );
}

