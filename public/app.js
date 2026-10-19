/**
 * Islamic Daily Prayer & Routine Tracker
 * Parent-Controlled Tracking Frontend Engine
 */

// Global State
const state = {
  token: localStorage.getItem('tracker_token') || null,
  user: null,
  parent: {
    children: [],
    selectedChildId: null,
    selectedDate: new Date().toISOString().substring(0, 10),
    data: null,
    activeTab: 'daily'
  },
  admin: {
    activeTab: 'overview',
    overview: null,
    records: [],
    classes: [],
    routines: [],
    students: [],
    settings: null
  },
  theme: localStorage.getItem('tracker_theme') || 'dark'
};

// Apply Theme
document.documentElement.setAttribute('data-theme', state.theme);
const themeBtn = document.getElementById('themeToggleBtn');
if (themeBtn) {
  themeBtn.innerText = state.theme === 'dark' ? '☀️' : '🌙';
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    localStorage.setItem('tracker_theme', state.theme);
    themeBtn.innerText = state.theme === 'dark' ? '☀️' : '🌙';
  });
}

// Toast Notifications
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// API Fetch Helper
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  try {
    const res = await fetch(path, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  } catch (err) {
    console.error('API Error:', err);
    throw err;
  }
}

// Quick Fill for Demo Testing
window.quickFill = function(mobile, password) {
  document.getElementById('loginMobile').value = mobile;
  document.getElementById('loginPassword').value = password;
};

// ==========================================
// 1. AUTHENTICATION & SESSION
// ==========================================

async function initSession() {
  if (!state.token) {
    showView('authView');
    return;
  }

  try {
    const res = await api('/api/auth/me');
    state.user = res.user;
    updateHeaderUI();
    routeByRole();
  } catch (err) {
    logout();
  }
}

function updateHeaderUI() {
  const profileEl = document.getElementById('userHeaderProfile');
  const nameEl = document.getElementById('headerUserName');
  const roleEl = document.getElementById('headerRolePill');
  const logoutBtn = document.getElementById('logoutBtn');

  if (state.user) {
    profileEl.style.display = 'flex';
    nameEl.innerText = state.user.display_name;
    roleEl.className = `role-pill role-${state.user.role}`;
    roleEl.innerText = state.user.role.replace('_', ' ');
    logoutBtn.style.display = 'flex';
  } else {
    profileEl.style.display = 'none';
    logoutBtn.style.display = 'none';
  }
}

function routeByRole() {
  if (!state.user) {
    showView('authView');
    return;
  }

  if (state.user.role === 'parent') {
    showView('parentView');
    initParentDashboard();
  } else if (state.user.role === 'institute_admin') {
    showView('adminView');
    initAdminDashboard();
  } else if (state.user.role === 'student') {
    showView('studentView');
    initStudentDashboard();
  } else if (state.user.role === 'super_admin') {
    showView('superAdminView');
    initSuperAdminDashboard();
  }
}

function showView(viewId) {
  ['authView', 'parentView', 'adminView', 'studentView', 'superAdminView'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id === viewId ? 'block' : 'none';
  });
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('tracker_token');
  updateHeaderUI();
  showView('authView');
  showToast('Logged out successfully', 'info');
}

document.getElementById('logoutBtn').addEventListener('click', logout);

// Login Form Submit
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const mobile = document.getElementById('loginMobile').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mobile_number: mobile, password })
    });

    state.token = res.token;
    state.user = res.user;
    localStorage.setItem('tracker_token', res.token);
    showToast(`Welcome back, ${res.user.display_name}!`);
    updateHeaderUI();
    routeByRole();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ==========================================
// 2. PARENT DASHBOARD & MULTI-CHILD LOGIC
// ==========================================

async function initParentDashboard() {
  // Set date picker to current selected date
  const datePicker = document.getElementById('selectedDatePicker');
  datePicker.value = state.parent.selectedDate;
  datePicker.addEventListener('change', (e) => {
    state.parent.selectedDate = e.target.value;
    loadChildDailyData();
  });

  document.getElementById('prevDayBtn').onclick = () => changeDate(-1);
  document.getElementById('nextDayBtn').onclick = () => changeDate(1);
  document.getElementById('todayBtn').onclick = () => {
    state.parent.selectedDate = new Date().toISOString().substring(0, 10);
    datePicker.value = state.parent.selectedDate;
    loadChildDailyData();
  };

  // Parent tab switches
  document.querySelectorAll('[data-parent-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-parent-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-parent-tab');
      state.parent.activeTab = tab;
      document.getElementById('parentDailyTab').style.display = tab === 'daily' ? 'block' : 'none';
      document.getElementById('parentReportsTab').style.display = tab === 'reports' ? 'block' : 'none';
      if (tab === 'reports') loadChildReport(30);
    };
  });

  // Load authorized children
  try {
    const res = await api('/api/parent/children');
    state.parent.children = res.children;
    renderChildrenChips();

    if (res.children.length > 0) {
      if (!state.parent.selectedChildId || !res.children.some(c => c.id === state.parent.selectedChildId)) {
        state.parent.selectedChildId = res.children[0].id;
      }
      loadChildDailyData();
    } else {
      document.getElementById('parentDailyTab').innerHTML = `
        <div class="card" style="text-align: center; padding: 40px 20px;">
          <h3>No Children Linked</h3>
          <p style="color: var(--text-muted); margin-top: 8px;">Please contact your institute administrator to authorize and link your child to this account.</p>
        </div>
      `;
    }
  } catch (err) {
    showToast('Failed to load children: ' + err.message, 'error');
  }
}

function changeDate(days) {
  const d = new Date(state.parent.selectedDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  state.parent.selectedDate = d.toISOString().substring(0, 10);
  document.getElementById('selectedDatePicker').value = state.parent.selectedDate;
  loadChildDailyData();
}

function renderChildrenChips() {
  const container = document.getElementById('childrenChipRow');
  container.innerHTML = '';

  state.parent.children.forEach(child => {
    const chip = document.createElement('div');
    chip.className = `child-chip ${child.id === state.parent.selectedChildId ? 'active' : ''}`;
    chip.innerHTML = `
      <div class="child-avatar">${child.student_name.charAt(0)}</div>
      <div class="child-info-text">
        <div class="child-name">${child.student_name}</div>
        <div class="child-class">${child.class_name} - ${child.division} (${child.admission_number || 'N/A'})</div>
      </div>
    `;
    chip.onclick = () => {
      if (state.parent.selectedChildId !== child.id) {
        state.parent.selectedChildId = child.id;
        renderChildrenChips();
        loadChildDailyData();
      }
    };
    container.appendChild(chip);
  });
}

async function loadChildDailyData() {
  if (!state.parent.selectedChildId) return;

  try {
    const res = await api(`/api/parent/child-data?student_id=${state.parent.selectedChildId}&date=${state.parent.selectedDate}`);
    state.parent.data = res;

    // Update Progress header
    document.getElementById('progressChildName').innerText = res.student.student_name;
    document.getElementById('progressChildClass').innerText = `${res.student.class_name} - ${res.student.division}`;

    // Policy notice banner
    const alertBanner = document.getElementById('policyAlertBanner');
    if (!res.is_editable) {
      alertBanner.style.display = 'flex';
      alertBanner.className = 'policy-alert locked';
      document.getElementById('policyAlertIcon').innerText = '🔒';
      document.getElementById('policyAlertText').innerText = res.editable_reason || 'Recording is locked for this date.';
    } else {
      alertBanner.style.display = 'none';
    }

    // Update Progress Counters
    const p = res.progress.prayers;
    document.getElementById('statCompletedPill').innerText = `✓ ${p.completed} Completed`;
    document.getElementById('statNotCompletedPill').innerText = `✗ ${p.not_completed} Not Done`;
    document.getElementById('statExcusedPill').innerText = `⊘ ${p.excused} Excused`;
    document.getElementById('statUnrecordedPill').innerText = `— ${p.not_recorded} Unrecorded`;

    const circle = document.getElementById('progressCircle');
    circle.style.setProperty('--progress', p.percentage);
    document.getElementById('progressPercentText').innerText = `${p.percentage}%`;

    // Render 5 Daily Prayers
    renderPrayersList(res.prayers, res.is_editable, res.settings);

    // Render Custom Routines
    renderCustomRoutinesList(res.custom_routines, res.is_editable, res.settings);

  } catch (err) {
    showToast('Failed to load child data: ' + err.message, 'error');
  }
}

function renderPrayersList(prayers, isEditable, settings) {
  const container = document.getElementById('prayersContainer');
  container.innerHTML = '';

  prayers.forEach(p => {
    const card = document.createElement('div');
    card.className = `prayer-card is-${p.status}`;

    let attributionHtml = '';
    if (p.is_admin_corrected) {
      attributionHtml = `<span class="attribution-tag tag-admin-correction" title="Corrected by Administrator">✏️ Admin Corrected</span>`;
    } else if (p.recorded_by_role === 'parent') {
      attributionHtml = `<span class="attribution-tag tag-parent">👨‍👧‍👦 Parent Recorded</span>`;
    }

    card.innerHTML = `
      <div class="prayer-header-row">
        <div class="prayer-titles">
          <span class="prayer-name-ml">${p.routine_name_ml}</span>
          <span class="prayer-name-en">(${p.routine_name_en || ''})</span>
        </div>
        <div class="prayer-meta">
          ${attributionHtml}
        </div>
      </div>
      <div class="status-selector-row">
        <button type="button" class="status-btn ${p.status === 'completed' ? 'selected-completed' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${p.routine_id}', 'completed')">
          ✓ Completed
        </button>
        <button type="button" class="status-btn ${p.status === 'not_completed' ? 'selected-not_completed' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${p.routine_id}', 'not_completed')">
          ✗ Not Done
        </button>
        ${settings.excused_status_enabled ? `
          <button type="button" class="status-btn ${p.status === 'excused' ? 'selected-excused' : ''}"
            ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${p.routine_id}', 'excused')">
            ⊘ Excused
          </button>
        ` : ''}
        <button type="button" class="status-btn ${p.status === 'not_recorded' ? 'selected-not_recorded' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${p.routine_id}', 'not_recorded')">
          — Reset
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

function renderCustomRoutinesList(routines, isEditable, settings) {
  const container = document.getElementById('customRoutinesContainer');
  container.innerHTML = '';

  if (routines.length === 0) {
    container.innerHTML = `<div style="font-size: 13px; color: var(--text-dim); padding: 10px;">No additional routines assigned to this class.</div>`;
    return;
  }

  routines.forEach(r => {
    const card = document.createElement('div');
    card.className = `prayer-card is-${r.status}`;

    let categoryClass = 'badge-routine';
    if (r.category === 'quran') categoryClass = 'badge-quran';
    else if (r.category === 'adhkar') categoryClass = 'badge-adhkar';

    card.innerHTML = `
      <div class="prayer-header-row">
        <div class="prayer-titles">
          <span class="prayer-name-ml">${r.routine_name_ml}</span>
          <span class="prayer-name-en">(${r.routine_name_en || ''})</span>
        </div>
        <span class="category-badge ${categoryClass}">${r.category}</span>
      </div>
      <div class="status-selector-row">
        <button type="button" class="status-btn ${r.status === 'completed' ? 'selected-completed' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${r.routine_id}', 'completed')">
          ✓ Completed
        </button>
        <button type="button" class="status-btn ${r.status === 'not_completed' ? 'selected-not_completed' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${r.routine_id}', 'not_completed')">
          ✗ Not Done
        </button>
        <button type="button" class="status-btn ${r.status === 'not_recorded' ? 'selected-not_recorded' : ''}"
          ${!isEditable ? 'disabled' : ''} onclick="recordStatus('${r.routine_id}', 'not_recorded')">
          — Reset
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

window.recordStatus = async function(routineId, status) {
  if (!state.parent.selectedChildId) return;

  try {
    const res = await api('/api/parent/record', {
      method: 'POST',
      body: JSON.stringify({
        student_id: state.parent.selectedChildId,
        routine_id: routineId,
        activity_date: state.parent.selectedDate,
        status: status
      })
    });

    showToast(`Saved status: ${status}`);
    // Refresh child data to recalculate progress and update UI
    loadChildDailyData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.loadChildReport = async function(days = 30) {
  if (!state.parent.selectedChildId) return;

  try {
    const res = await api(`/api/parent/reports?student_id=${state.parent.selectedChildId}&days=${days}`);

    // Render Summary Cards
    const summaryEl = document.getElementById('reportSummaryCards');
    summaryEl.innerHTML = `
      <div class="card" style="padding: 12px; margin-bottom: 0;">
        <div style="font-size: 11px; color: var(--text-muted);">Completed Prayers</div>
        <div style="font-size: 22px; font-weight: 800; color: #34d399;">${res.summary.completed_prayers}</div>
      </div>
      <div class="card" style="padding: 12px; margin-bottom: 0;">
        <div style="font-size: 11px; color: var(--text-muted);">Missed Prayers</div>
        <div style="font-size: 22px; font-weight: 800; color: #f87171;">${res.summary.missed_prayers}</div>
      </div>
      <div class="card" style="padding: 12px; margin-bottom: 0;">
        <div style="font-size: 11px; color: var(--text-muted);">Excused</div>
        <div style="font-size: 22px; font-weight: 800; color: #c084fc;">${res.summary.excused_prayers}</div>
      </div>
      <div class="card" style="padding: 12px; margin-bottom: 0;">
        <div style="font-size: 11px; color: var(--text-muted);">Recorded Days</div>
        <div style="font-size: 22px; font-weight: 800; color: var(--gold-light);">${res.summary.recorded_days_count}</div>
      </div>
    `;

    // Render Table
    const tbody = document.getElementById('parentReportTableBody');
    tbody.innerHTML = '';

    if (res.history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No records found in this time period.</td></tr>`;
      return;
    }

    res.history.forEach(day => {
      const pMap = {};
      day.prayers.forEach(p => (pMap[p.routine_name_en] = p.status));

      const formatStatus = (s) => {
        if (!s || s === 'not_recorded') return '<span class="stat-pill pill-unrecorded">—</span>';
        if (s === 'completed') return '<span class="stat-pill pill-completed">✓</span>';
        if (s === 'not_completed') return '<span class="stat-pill pill-not-completed">✗</span>';
        if (s === 'excused') return '<span class="stat-pill pill-excused">⊘</span>';
        return s;
      };

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${day.date}</b></td>
        <td>${formatStatus(pMap['Fajr'])}</td>
        <td>${formatStatus(pMap['Dhuhr'])}</td>
        <td>${formatStatus(pMap['Asr'])}</td>
        <td>${formatStatus(pMap['Maghrib'])}</td>
        <td>${formatStatus(pMap['Isha'])}</td>
        <td>${day.custom_routines.length} completed</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast('Failed to load report: ' + err.message, 'error');
  }
};

// ==========================================
// 3. INSTITUTE ADMINISTRATOR DASHBOARD
// ==========================================

async function initAdminDashboard() {
  document.querySelectorAll('[data-admin-tab]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-admin-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.getAttribute('data-admin-tab');
      state.admin.activeTab = tab;

      ['adminOverviewTab', 'adminRecordsTab', 'adminRoutinesTab', 'adminClassesTab',
       'adminParentsTab', 'adminMentorsTab', 'adminSettingsTab'].forEach(tId => {
        const el = document.getElementById(tId);
        if (el) el.style.display = tId === `admin${capitalize(tab)}Tab` ? 'block' : 'none';
      });

      if (tab === 'overview') loadAdminOverview();
      else if (tab === 'records') loadAdminRecords();
      else if (tab === 'routines') loadAdminRoutines();
      else if (tab === 'classes') loadAdminClassesAndStudents();
      else if (tab === 'parents') loadAdminParents();
      else if (tab === 'mentors') loadAdminMentors();
      else if (tab === 'settings') loadAdminSettings();
    };
  });

  loadAdminOverview();
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadAdminOverview() {
  try {
    const res = await api('/api/admin/overview');
    state.admin.overview = res;

    document.getElementById('adminTotalStudents').innerText = res.counts.totalStudents;
    document.getElementById('adminTotalClasses').innerText = res.counts.totalClasses;
    document.getElementById('adminTodayRate').innerText = `${res.todayPrayerStats.completionRate}%`;
    document.getElementById('adminUnrecordedCount').innerText = res.todayPrayerStats.not_recorded;

    // Recent corrections table
    const tbody = document.getElementById('adminRecentCorrectionsBody');
    tbody.innerHTML = '';
    if (res.recentCorrections.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No administrative corrections recorded yet.</td></tr>`;
      return;
    }

    res.recentCorrections.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(c.action_timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td><b>${c.student_name}</b></td>
        <td>${c.routine_name_ml} (${c.routine_name_en || ''})</td>
        <td><span class="stat-pill pill-${c.new_status}">${c.previous_status} ➔ ${c.new_status}</span></td>
        <td style="color: var(--gold-light);">"${c.reason || 'None'}"</td>
        <td>${c.actor_name}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminRecords() {
  const dateInput = document.getElementById('adminFilterDate');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().substring(0, 10);
  }

  // Populate class dropdown
  if (state.admin.classes.length === 0) {
    const cRes = await api('/api/admin/classes');
    state.admin.classes = cRes.classes;
    const select = document.getElementById('adminFilterClass');
    select.innerHTML = '<option value="">All Classes</option>';
    cRes.classes.forEach(c => {
      select.innerHTML += `<option value="${c.id}">${c.class_name} ${c.division}</option>`;
    });
  }

  const date = dateInput.value;
  const classId = document.getElementById('adminFilterClass').value;
  const status = document.getElementById('adminFilterStatus').value;

  let url = `/api/admin/records?date=${date}`;
  if (classId) url += `&class_id=${classId}`;
  if (status) url += `&status=${status}`;

  try {
    const res = await api(url);
    const tbody = document.getElementById('adminRecordsTableBody');
    tbody.innerHTML = '';

    if (res.records.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-dim);">No matching records found.</td></tr>`;
      return;
    }

    res.records.forEach(r => {
      const isCorrected = r.recorded_by_role === 'institute_admin';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${r.student_name}</b> (${r.admission_number || '-'})</td>
        <td>${r.class_name} ${r.division}</td>
        <td>${r.routine_name_ml} ${r.is_prayer ? '🕌' : '📖'}</td>
        <td><span class="stat-pill pill-${r.status}">${r.status}</span></td>
        <td>
          <span class="attribution-tag ${isCorrected ? 'tag-admin-correction' : 'tag-parent'}">
            ${isCorrected ? '✏️ Admin Corrected' : '👨‍👧‍👦 Parent Recorded'}
          </span>
        </td>
        <td>
          <button class="btn-secondary" style="padding: 4px 10px; font-size: 11.5px;"
            onclick="openCorrectionModal('${r.student_id}', '${r.student_name}', '${r.routine_id}', '${r.routine_name_ml}', '${r.activity_date}', '${r.status}')">
            Correct Record
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Administrative Correction Modal
window.openCorrectionModal = function(studentId, studentName, routineId, routineName, date, currentStatus) {
  document.getElementById('corrStudentId').value = studentId;
  document.getElementById('corrRoutineId').value = routineId;
  document.getElementById('corrDate').value = date;
  document.getElementById('corrModalStudent').innerText = studentName;
  document.getElementById('corrModalRoutine').innerText = routineName;
  document.getElementById('corrModalDate').innerText = date;
  document.getElementById('corrNewStatus').value = currentStatus;
  document.getElementById('corrReason').value = '';

  document.getElementById('correctionModal').style.display = 'flex';
};

window.closeCorrectionModal = function() {
  document.getElementById('correctionModal').style.display = 'none';
};

window.submitCorrection = async function() {
  const studentId = document.getElementById('corrStudentId').value;
  const routineId = document.getElementById('corrRoutineId').value;
  const date = document.getElementById('corrDate').value;
  const newStatus = document.getElementById('corrNewStatus').value;
  const reason = document.getElementById('corrReason').value;

  if (!reason || reason.trim().length === 0) {
    showToast('A mandatory correction reason is required.', 'error');
    return;
  }

  try {
    await api('/api/admin/correct-record', {
      method: 'POST',
      body: JSON.stringify({
        student_id: studentId,
        routine_id: routineId,
        activity_date: date,
        new_status: newStatus,
        reason: reason.trim()
      })
    });

    showToast('Record successfully corrected with audit log entry!');
    closeCorrectionModal();
    loadAdminRecords();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function loadAdminRoutines() {
  try {
    const res = await api('/api/admin/routines');
    const tbody = document.getElementById('adminRoutinesTableBody');
    tbody.innerHTML = '';

    res.routines.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.display_order}</td>
        <td><b>${r.routine_name_ml}</b></td>
        <td>${r.routine_name_en || '-'}</td>
        <td><span class="category-badge badge-${r.category}">${r.category}</span></td>
        <td>${r.assigned_classes_text || 'All Classes'}</td>
        <td>${r.is_prayer === 1 ? '🕋 Mandatory Prayer' : '✨ Custom Routine'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.openNewRoutineModal = async function() {
  const container = document.getElementById('routineClassCheckboxList');
  container.innerHTML = '';

  if (state.admin.classes.length === 0) {
    const cRes = await api('/api/admin/classes');
    state.admin.classes = cRes.classes;
  }

  state.admin.classes.forEach(c => {
    container.innerHTML += `
      <div style="margin-bottom: 4px;">
        <input type="checkbox" id="chk_cls_${c.id}" value="${c.id}">
        <label for="chk_cls_${c.id}">${c.class_name} ${c.division}</label>
      </div>
    `;
  });

  document.getElementById('newRoutineModal').style.display = 'flex';
};

window.closeNewRoutineModal = function() {
  document.getElementById('newRoutineModal').style.display = 'none';
};

window.toggleRoutineClassList = function() {
  const isSelected = document.getElementById('asgSelect').checked;
  document.getElementById('routineClassCheckboxList').style.display = isSelected ? 'block' : 'none';
};

window.submitNewRoutine = async function() {
  const nameMl = document.getElementById('routineNameMl').value.trim();
  const nameEn = document.getElementById('routineNameEn').value.trim();
  const category = document.getElementById('routineCategory').value;
  const isAll = document.getElementById('asgAll').checked;

  if (!nameMl) {
    showToast('Malayalam name is required.', 'error');
    return;
  }

  const selectedClassIds = [];
  if (!isAll) {
    const chks = document.querySelectorAll('#routineClassCheckboxList input[type="checkbox"]:checked');
    chks.forEach(c => selectedClassIds.push(c.value));
    if (selectedClassIds.length === 0) {
      showToast('Select at least one class or choose All Classes.', 'error');
      return;
    }
  }

  try {
    await api('/api/admin/routines', {
      method: 'POST',
      body: JSON.stringify({
        routine_name_ml: nameMl,
        routine_name_en: nameEn,
        category: category,
        applies_to_all_classes: isAll ? 1 : 0,
        class_ids: selectedClassIds
      })
    });

    showToast('Custom routine created successfully!');
    closeNewRoutineModal();
    loadAdminRoutines();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

async function loadAdminClassesAndStudents() {
  try {
    const cRes = await api('/api/admin/classes');
    const sRes = await api('/api/admin/students');

    const cTbody = document.getElementById('adminClassesTableBody');
    cTbody.innerHTML = '';
    cRes.classes.forEach(c => {
      cTbody.innerHTML += `
        <tr>
          <td>Class ${c.class_number}</td>
          <td><b>${c.class_name} - ${c.division}</b></td>
          <td>${c.student_count} Enrolled</td>
          <td><span class="stat-pill pill-completed">Active</span></td>
        </tr>
      `;
    });

    const sTbody = document.getElementById('adminStudentsTableBody');
    sTbody.innerHTML = '';
    sRes.students.forEach(s => {
      sTbody.innerHTML += `
        <tr>
          <td>${s.admission_number || '-'}</td>
          <td><b>${s.student_name}</b></td>
          <td>${s.class_name} ${s.division}</td>
          <td>${s.parents_info || '<span style="color:red">No Parent Linked</span>'}</td>
          <td><span class="stat-pill pill-${s.account_status === 'active' ? 'completed' : 'unrecorded'}">${s.account_status}</span></td>
        </tr>
      `;
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadAdminSettings() {
  try {
    const res = await api('/api/admin/settings');
    const s = res.settings;
    document.getElementById('settingBackdateDays').value = s.allowed_backdate_days ?? 7;
    document.getElementById('settingDeadline').value = s.record_edit_deadline || '23:59';
    document.getElementById('settingParentEnabled').checked = s.parent_recording_enabled === 1;
    document.getElementById('settingStudentReadOnly').checked = s.student_read_only_enabled === 1;
    document.getElementById('settingExcusedEnabled').checked = s.excused_status_enabled === 1;
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.getElementById('instituteSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({
        allowed_backdate_days: document.getElementById('settingBackdateDays').value,
        record_edit_deadline: document.getElementById('settingDeadline').value,
        parent_recording_enabled: document.getElementById('settingParentEnabled').checked ? 1 : 0,
        student_read_only_enabled: document.getElementById('settingStudentReadOnly').checked ? 1 : 0,
        excused_status_enabled: document.getElementById('settingExcusedEnabled').checked ? 1 : 0
      })
    });
    showToast('Institute recording policy updated successfully!');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

window.exportAdminReport = function(format = 'csv') {
  const date = document.getElementById('adminFilterDate').value || new Date().toISOString().substring(0, 10);
  const classId = document.getElementById('adminFilterClass').value;
  let url = `/api/admin/reports/export?format=${format}&date=${date}`;
  if (classId) url += `&class_id=${classId}`;

  // Download directly
  window.open(url, '_blank');
};

// ==========================================
// 4. STUDENT READ-ONLY PROGRESS
// ==========================================

async function initStudentDashboard() {
  try {
    const res = await api('/api/student/my-progress');
    document.getElementById('studentViewTitle').innerText = `${res.student.name} (${res.student.class})`;

    const container = document.getElementById('studentPrayersContainer');
    container.innerHTML = '';

    res.prayers.forEach(p => {
      const card = document.createElement('div');
      card.className = `prayer-card is-${p.status}`;
      card.innerHTML = `
        <div class="prayer-header-row">
          <div class="prayer-titles">
            <span class="prayer-name-ml">${p.routine_name_ml}</span>
            <span class="prayer-name-en">(${p.routine_name_en || ''})</span>
          </div>
          <span class="stat-pill pill-${p.status}">${p.status}</span>
        </div>
        <div style="font-size: 12px; color: var(--text-dim);">Recorded By: ${p.recorded_by}</div>
      `;
      container.appendChild(card);
    });
  } catch (err) {
    document.getElementById('studentView').innerHTML = `
      <div class="card" style="text-align: center; padding: 40px;">
        <h3>Access Notice</h3>
        <p style="color: var(--text-muted); margin-top: 10px;">${err.message}</p>
      </div>
    `;
  }
}

// ==========================================
// 5. SUPER ADMINISTRATOR DASHBOARD
// ==========================================

async function initSuperAdminDashboard() {
  try {
    const res = await api('/api/super-admin/institutes');
    const tbody = document.getElementById('superAdminInstitutesBody');
    tbody.innerHTML = '';

    res.institutes.forEach(inst => {
      const isApproved = inst.approval_status === 'approved';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${inst.name}</b></td>
        <td>${inst.registration_number || 'N/A'}</td>
        <td>${inst.admin_name || 'N/A'}</td>
        <td>${inst.admin_mobile || 'N/A'}</td>
        <td><span class="stat-pill pill-${isApproved ? 'completed' : 'not-completed'}">${inst.approval_status}</span></td>
        <td><span class="category-badge badge-adhkar">${inst.subscription_status}</span></td>
        <td>
          ${!isApproved ? `
            <button class="btn-primary" style="padding: 4px 10px; font-size: 11px;" onclick="approveInstitute('${inst.id}', 'approved')">Approve</button>
          ` : `
            <button class="btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="approveInstitute('${inst.id}', 'rejected')">Revoke</button>
          `}
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Payments
    const payRes = await api('/api/super-admin/payments');
    const pTbody = document.getElementById('superAdminPaymentsBody');
    pTbody.innerHTML = '';
    payRes.payments.forEach(p => {
      pTbody.innerHTML += `
        <tr>
          <td><b>${p.institute_name}</b></td>
          <td>${p.plan_name}</td>
          <td>₹${p.amount}</td>
          <td>${p.payment_reference}</td>
          <td><span class="stat-pill pill-${p.payment_status === 'verified' ? 'completed' : 'not-completed'}">${p.payment_status}</span></td>
          <td>
            ${p.payment_status !== 'verified' ? `
              <button class="btn-primary" style="padding: 4px 10px; font-size: 11px;" onclick="verifyPayment('${p.id}', 'verify')">Verify</button>
            ` : '<span style="color: #34d399; font-weight: 700;">Verified ✓</span>'}
          </td>
        </tr>
      `;
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.approveInstitute = async function(instituteId, status) {
  try {
    await api('/api/super-admin/institutes/approve', {
      method: 'POST',
      body: JSON.stringify({ institute_id: instituteId, approval_status: status })
    });
    showToast(`Institute ${status} successfully!`);
    initSuperAdminDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.verifyPayment = async function(paymentId, action) {
  try {
    await api('/api/super-admin/payments/verify', {
      method: 'POST',
      body: JSON.stringify({ payment_id: paymentId, action })
    });
    showToast('Payment verified and subscription activated!');
    initSuperAdminDashboard();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==========================================
// 6. INSTITUTE REGISTRATION MODAL
// ==========================================

const regModal = document.getElementById('registerModal');
document.getElementById('openRegisterModalBtn').onclick = () => { regModal.style.display = 'flex'; };
window.closeRegisterModal = function() { regModal.style.display = 'none'; };

document.getElementById('registerInstituteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/auth/register-institute', {
      method: 'POST',
      body: JSON.stringify({
        institute_name: document.getElementById('regInstName').value,
        registration_number: document.getElementById('regRegNumber').value,
        admin_name: document.getElementById('regAdminName').value,
        mobile_number: document.getElementById('regMobile').value,
        password: document.getElementById('regPassword').value
      })
    });
    showToast(res.message);
    closeRegisterModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
});


// ==========================================
// 6. PARENTS MANAGEMENT (Admin)
// ==========================================

// Track existing-parent state during add-parent flow
let _existingParentId = null;

async function loadAdminParents() {
  const search = (document.getElementById('parentSearchInput') || {}).value || '';
  const tbody = document.getElementById('adminParentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">Loading…</td></tr>';

  try {
    const res = await api(`/api/admin/parents?search=${encodeURIComponent(search)}`);
    tbody.innerHTML = '';

    if (!res.parents || res.parents.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">
        No parents found. Click <b>+ Add Parent</b> to create the first one.
      </td></tr>`;
      return;
    }

    res.parents.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${esc(p.display_name)}</b></td>
        <td>${esc(p.mobile_number)}</td>
        <td><span class="category-badge badge-quran">${p.student_count} student${p.student_count !== 1 ? 's' : ''}</span></td>
        <td><span class="stat-pill pill-${p.account_status === 'active' ? 'completed' : 'unrecorded'}">${p.account_status}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn-secondary" style="padding:4px 10px;font-size:11.5px;"
            onclick="viewParentDetail('${p.id}','${esc(p.display_name)}')">👁 View</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--status-not_completed);">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ── Add Parent Modal ──────────────────────────────────────────────────────────

window.openAddParentModal = async function() {
  _existingParentId = null;
  document.getElementById('addParentMobile').value = '';
  document.getElementById('addParentName').value = '';
  document.getElementById('addParentPassword').value = '';
  document.getElementById('parentMobileLookupResult').innerHTML = '';
  document.getElementById('existingParentAlert').style.display = 'none';
  document.getElementById('addParentSubmitBtn').textContent = 'Save Parent';

  // Load classes for student dropdowns
  if (state.admin.classes.length === 0) {
    try {
      const r = await api('/api/admin/classes');
      state.admin.classes = r.classes;
    } catch (e) { /* ignore */ }
  }

  // Clear and seed one student row
  const container = document.getElementById('studentEntriesContainer');
  container.innerHTML = '';
  addStudentEntry();

  document.getElementById('addParentModal').style.display = 'flex';
};

window.closeAddParentModal = function() {
  document.getElementById('addParentModal').style.display = 'none';
};

window.clearParentLookup = function() {
  _existingParentId = null;
  document.getElementById('parentMobileLookupResult').innerHTML = '';
  document.getElementById('existingParentAlert').style.display = 'none';
  document.getElementById('addParentSubmitBtn').textContent = 'Save Parent';

  // Re-show password field when mobile is cleared
  const pwGroup = document.getElementById('addParentPassword').closest('.form-group');
  if (pwGroup) pwGroup.style.display = '';
};

window.checkParentMobile = async function() {
  const mobile = document.getElementById('addParentMobile').value.trim();
  const resultEl = document.getElementById('parentMobileLookupResult');
  const alertEl  = document.getElementById('existingParentAlert');

  if (!mobile) { resultEl.innerHTML = '<span style="color:orange;">Please enter a mobile number first.</span>'; return; }

  try {
    const r = await api('/api/admin/parents/check-mobile', {
      method: 'POST',
      body: JSON.stringify({ mobile })
    });

    if (!r.exists) {
      resultEl.innerHTML = '<span style="color:#34d399;">✓ Mobile not yet registered — a new parent account will be created.</span>';
      _existingParentId = null;
      alertEl.style.display = 'none';
      document.getElementById('addParentSubmitBtn').textContent = 'Save Parent';
    } else if (r.same_institute && r.parent_id) {
      _existingParentId = r.parent_id;
      resultEl.innerHTML = `<span style="color:var(--gold-light);">⚠️ Parent already exists: <b>${esc(r.display_name)}</b></span>`;

      const stuList = (r.existing_students || []).map(s =>
        `• ${esc(s.student_name)} (${esc(s.class_name)} ${esc(s.division)}, Reg: ${esc(s.admission_number || 'N/A')})`
      ).join('<br>');

      alertEl.style.display = 'block';
      alertEl.innerHTML = `<b>Existing parent found.</b> The students below are already linked. New students entered below will be <b>added to this existing account</b> — no duplicate account will be created.<br><br>${stuList || 'No students linked yet.'}`;
      document.getElementById('addParentSubmitBtn').textContent = 'Add Students to Existing Parent';

      // Hide password field (not needed for existing parent)
      const pwGroup = document.getElementById('addParentPassword').closest('.form-group');
      if (pwGroup) pwGroup.style.display = 'none';
      document.getElementById('addParentName').value = r.display_name;
    } else {
      resultEl.innerHTML = `<span style="color:var(--status-not_completed);">✗ ${esc(r.message || 'This number is already registered under another role.')}</span>`;
      _existingParentId = null;
    }
  } catch (err) {
    resultEl.innerHTML = `<span style="color:var(--status-not_completed);">Error: ${esc(err.message)}</span>`;
  }
};

let _studentRowCount = 0;

window.addStudentEntry = function() {
  _studentRowCount++;
  const idx = _studentRowCount;
  const classOptions = state.admin.classes.map(c =>
    `<option value="${c.id}">${esc(c.class_name)} ${esc(c.division)}</option>`
  ).join('');

  const container = document.getElementById('studentEntriesContainer');
  const div = document.createElement('div');
  div.id = `studentRow_${idx}`;
  div.style.cssText = 'background:var(--surface-card);border-radius:var(--radius-sm);padding:12px;margin-bottom:10px;border:1px solid var(--border-subtle);';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:12px;font-weight:700;color:var(--primary-light);">Student ${idx}</span>
      ${idx > 1 ? `<button type="button" class="btn-icon" onclick="removeStudentRow(${idx})" title="Remove this student" style="color:var(--status-not_completed);font-size:14px;">✕</button>` : ''}
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="form-label">Student Name *</label>
      <input type="text" id="stuName_${idx}" class="form-input" placeholder="e.g. Muhammed Bilal">
    </div>
    <div class="form-group" style="margin-bottom:8px;">
      <label class="form-label">Register / Admission Number *</label>
      <input type="text" id="stuReg_${idx}" class="form-input" placeholder="e.g. 2026/001">
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <label class="form-label">Class *</label>
      <select id="stuClass_${idx}" class="form-select">
        <option value="">— Select Class —</option>
        ${classOptions}
      </select>
    </div>
  `;
  container.appendChild(div);
};

window.removeStudentRow = function(idx) {
  const el = document.getElementById(`studentRow_${idx}`);
  if (el) el.remove();
};

window.submitAddParent = async function() {
  const mobile   = document.getElementById('addParentMobile').value.trim();
  const name     = document.getElementById('addParentName').value.trim();
  const password = document.getElementById('addParentPassword').value;

  if (!mobile || !name) {
    showToast('Parent mobile and name are required.', 'error');
    return;
  }

  // Collect all visible student rows
  const rows = document.querySelectorAll('[id^="studentRow_"]');
  const students = [];
  let valid = true;

  rows.forEach(row => {
    const idx = row.id.replace('studentRow_', '');
    const stuName  = (document.getElementById(`stuName_${idx}`) || {}).value?.trim();
    const stuReg   = (document.getElementById(`stuReg_${idx}`) || {}).value?.trim();
    const stuClass = (document.getElementById(`stuClass_${idx}`) || {}).value;

    if (!stuName || !stuReg || !stuClass) { valid = false; return; }
    students.push({ student_name: stuName, register_number: stuReg, class_id: stuClass });
  });

  if (!valid || students.length === 0) {
    showToast('All student fields (Name, Register Number, Class) are required for every student entry.', 'error');
    return;
  }

  try {
    if (_existingParentId) {
      // Add students to existing parent
      await api(`/api/admin/parents/${_existingParentId}/add-students`, {
        method: 'POST',
        body: JSON.stringify({ students })
      });
      showToast(`${students.length} student(s) added to existing parent successfully!`);
    } else {
      if (!password || password.length < 6) {
        showToast('Initial password must be at least 6 characters.', 'error');
        return;
      }
      await api('/api/admin/parents', {
        method: 'POST',
        body: JSON.stringify({ parent_mobile: mobile, parent_name: name, initial_password: password, students })
      });
      showToast(`Parent account created with ${students.length} student(s) linked!`);
    }

    closeAddParentModal();
    loadAdminParents();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ── View Parent Detail ────────────────────────────────────────────────────────

window.viewParentDetail = async function(parentId, parentName) {
  document.getElementById('viewParentModalTitle').textContent = `👨‍👧‍👦 ${parentName}`;
  document.getElementById('viewParentDetailBody').innerHTML = '<div style="color:var(--text-dim);">Loading…</div>';
  document.getElementById('addStudentsToExistingBtn').style.display = 'none';
  document.getElementById('viewParentModal').style.display = 'flex';

  try {
    const res = await api(`/api/admin/parents/${parentId}`);
    const { parent, students } = res;

    const stuRows = students.length === 0
      ? '<tr><td colspan="4" style="color:var(--text-dim);text-align:center;">No students linked.</td></tr>'
      : students.map(s => `
          <tr>
            <td><b>${esc(s.student_name)}</b></td>
            <td>${esc(s.admission_number || '—')}</td>
            <td>${esc(s.class_name)} ${esc(s.division)}</td>
            <td><span class="stat-pill pill-${s.account_status === 'active' ? 'completed' : 'unrecorded'}">${s.account_status}</span></td>
          </tr>`).join('');

    document.getElementById('viewParentDetailBody').innerHTML = `
      <div style="margin-bottom:12px;">
        <div><b>Mobile:</b> ${esc(parent.mobile_number)}</div>
        <div><b>Status:</b> <span class="stat-pill pill-${parent.account_status === 'active' ? 'completed' : 'unrecorded'}">${parent.account_status}</span></div>
        <div><b>Joined:</b> ${new Date(parent.created_at).toLocaleDateString()}</div>
      </div>
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;">Linked Students (${students.length})</div>
      <div class="data-table-wrapper">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Reg. No.</th><th>Class</th><th>Status</th></tr></thead>
          <tbody>${stuRows}</tbody>
        </table>
      </div>
    `;

    // Show "Add More Students" button — store parentId on it
    const addBtn = document.getElementById('addStudentsToExistingBtn');
    addBtn.style.display = 'inline-flex';
    addBtn.dataset.parentId = parentId;
    addBtn.dataset.parentName = parentName;
  } catch (err) {
    document.getElementById('viewParentDetailBody').innerHTML = `<div style="color:var(--status-not_completed);">Error: ${esc(err.message)}</div>`;
  }
};

window.closeViewParentModal = function() {
  document.getElementById('viewParentModal').style.display = 'none';
};

window.openAddStudentsToParent = async function() {
  const btn = document.getElementById('addStudentsToExistingBtn');
  const parentId   = btn.dataset.parentId;
  const parentName = btn.dataset.parentName;

  closeViewParentModal();

  // Reuse Add Parent modal but pre-populate for existing parent
  _existingParentId = parentId;
  document.getElementById('addParentMobile').value = '';
  document.getElementById('addParentName').value = parentName;
  document.getElementById('addParentPassword').value = '';

  const pwGroup = document.getElementById('addParentPassword').closest('.form-group');
  if (pwGroup) pwGroup.style.display = 'none';

  document.getElementById('parentMobileLookupResult').innerHTML =
    `<span style="color:var(--gold-light);">Adding students to existing parent: <b>${esc(parentName)}</b></span>`;

  const alertEl = document.getElementById('existingParentAlert');
  alertEl.style.display = 'block';
  alertEl.innerHTML = `<b>Adding students to existing parent account:</b> ${esc(parentName)}`;
  document.getElementById('addParentSubmitBtn').textContent = 'Add Students to Existing Parent';

  if (state.admin.classes.length === 0) {
    const r = await api('/api/admin/classes');
    state.admin.classes = r.classes;
  }

  const container = document.getElementById('studentEntriesContainer');
  container.innerHTML = '';
  addStudentEntry();

  document.getElementById('addParentModal').style.display = 'flex';
};

// ==========================================
// 7. MENTORS MANAGEMENT (Admin)
// ==========================================

async function loadAdminMentors() {
  const search = (document.getElementById('mentorSearchInput') || {}).value || '';
  const tbody = document.getElementById('adminMentorsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">Loading…</td></tr>';

  try {
    const res = await api(`/api/admin/mentors?search=${encodeURIComponent(search)}`);
    tbody.innerHTML = '';

    if (!res.mentors || res.mentors.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">
        No mentors yet. Click <b>+ Add Mentor</b> to add one.
      </td></tr>`;
      return;
    }

    res.mentors.forEach(m => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><b>${esc(m.display_name)}</b></td>
        <td>${esc(m.mobile_number)}</td>
        <td><span style="font-size:12px;">${esc(m.assigned_classes_text || '—')}</span></td>
        <td><span class="stat-pill pill-${m.account_status === 'active' ? 'completed' : 'unrecorded'}">${m.account_status}</span></td>
        <td style="white-space:nowrap;">
          <button class="btn-secondary" style="padding:4px 10px;font-size:11.5px;"
            onclick="openEditMentorModal('${m.id}','${esc(m.display_name)}','${m.account_status}')">✏️ Edit</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--status-not_completed);">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ── Add Mentor Modal ──────────────────────────────────────────────────────────

window.openAddMentorModal = async function() {
  document.getElementById('addMentorMobile').value   = '';
  document.getElementById('addMentorName').value     = '';
  document.getElementById('addMentorPassword').value = '';

  // Populate class checkboxes
  const listEl = document.getElementById('mentorClassCheckboxList');
  listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">Loading…</div>';

  if (state.admin.classes.length === 0) {
    try {
      const r = await api('/api/admin/classes');
      state.admin.classes = r.classes;
    } catch (e) { /* ignore */ }
  }

  listEl.innerHTML = '';
  if (state.admin.classes.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-dim);">No active classes found. Add classes first.</div>';
  } else {
    state.admin.classes.forEach(c => {
      listEl.innerHTML += `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
          <input type="checkbox" name="addMentorClass" value="${c.id}" style="width:16px;height:16px;">
          <span>${esc(c.class_name)} ${esc(c.division)}</span>
        </label>
      `;
    });
  }

  document.getElementById('addMentorModal').style.display = 'flex';
};

window.closeAddMentorModal = function() {
  document.getElementById('addMentorModal').style.display = 'none';
};

window.submitAddMentor = async function() {
  const mobile   = document.getElementById('addMentorMobile').value.trim();
  const name     = document.getElementById('addMentorName').value.trim();
  const password = document.getElementById('addMentorPassword').value;

  if (!mobile || !name) {
    showToast('Mentor mobile and name are required.', 'error');
    return;
  }
  if (!password || password.length < 6) {
    showToast('Initial password must be at least 6 characters.', 'error');
    return;
  }

  const checked = [...document.querySelectorAll('input[name="addMentorClass"]:checked')].map(c => c.value);
  if (checked.length === 0) {
    showToast('Please assign at least one class to this mentor.', 'error');
    return;
  }

  try {
    await api('/api/admin/mentors', {
      method: 'POST',
      body: JSON.stringify({ mentor_mobile: mobile, mentor_name: name, initial_password: password, class_ids: checked })
    });
    showToast(`Mentor "${name}" created and ${checked.length} class(es) assigned!`);
    closeAddMentorModal();
    loadAdminMentors();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ── Edit Mentor Modal ─────────────────────────────────────────────────────────

window.openEditMentorModal = async function(mentorId, mentorName, mentorStatus) {
  document.getElementById('editMentorId').value   = mentorId;
  document.getElementById('editMentorName').value = mentorName;
  document.getElementById('editMentorStatus').value = mentorStatus;

  const listEl = document.getElementById('editMentorClassList');
  listEl.innerHTML = '<div style="color:var(--text-dim);font-size:12px;">Loading…</div>';

  document.getElementById('editMentorModal').style.display = 'flex';

  try {
    // Load mentor detail (to get currently assigned class IDs)
    const [detailRes, classRes] = await Promise.all([
      api(`/api/admin/mentors/${mentorId}`),
      state.admin.classes.length > 0
        ? Promise.resolve({ classes: state.admin.classes })
        : api('/api/admin/classes')
    ]);

    if (!state.admin.classes.length) state.admin.classes = classRes.classes;

    const assignedIds = new Set((detailRes.classes || []).map(c => c.id));

    listEl.innerHTML = '';
    state.admin.classes.forEach(c => {
      listEl.innerHTML += `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;">
          <input type="checkbox" name="editMentorClass" value="${c.id}"
            ${assignedIds.has(c.id) ? 'checked' : ''} style="width:16px;height:16px;">
          <span>${esc(c.class_name)} ${esc(c.division)}</span>
        </label>
      `;
    });
  } catch (err) {
    listEl.innerHTML = `<div style="color:var(--status-not_completed);">Error: ${esc(err.message)}</div>`;
  }
};

window.closeEditMentorModal = function() {
  document.getElementById('editMentorModal').style.display = 'none';
};

window.submitEditMentor = async function() {
  const mentorId = document.getElementById('editMentorId').value;
  const name     = document.getElementById('editMentorName').value.trim();
  const status   = document.getElementById('editMentorStatus').value;
  const checked  = [...document.querySelectorAll('input[name="editMentorClass"]:checked')].map(c => c.value);

  if (!name) { showToast('Mentor name is required.', 'error'); return; }
  if (checked.length === 0) { showToast('Assign at least one class.', 'error'); return; }

  try {
    await api(`/api/admin/mentors/${mentorId}`, {
      method: 'PATCH',
      body: JSON.stringify({ display_name: name, account_status: status, class_ids: checked })
    });
    showToast('Mentor updated successfully!');
    closeEditMentorModal();
    loadAdminMentors();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ── Utility: HTML escape ──────────────────────────────────────────────────────
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Start app
initSession();

// ==========================================
// 8. WHATSAPP SHARE
// ==========================================

window.shareOnWhatsApp = function(customText) {
  const currentUrl = window.location.origin;
  const text = customText || ('🕌 *SALATI — صَلَاتِي*\n*Islamic Daily Prayer & Routine Tracker*\n\n' +
    'Track children\'s daily 5 prayers (Fajr, Dhuhr, Asr, Maghrib, Isha), Quran recitation, and Sunnah routines.\n\n' +
    '📱 *Open the App here:*\n' + currentUrl + '\n\n' +
    'Log in with your authorized mobile number to record and view prayer progress.');
  const whatsappUrl = 'https://api.whatsapp.com/send?text=' + encodeURIComponent(text);
  window.open(whatsappUrl, '_blank');
};

window.shareParentInviteWhatsApp = function() {
  const currentUrl = window.location.origin;
  const text = 'Assalamu Alaikum wa Rahmatullah,\n\n' +
    'Dear Parents,\n' +
    'Please access the *SALATI (صَلَاتِي) Daily Prayer & Routine Tracker* to record your child\'s daily prayers.\n\n' +
    '🌐 *App Link:*\n' + currentUrl + '\n\n' +
    '📱 *Instructions:*\n' +
    '1. Open the link above.\n' +
    '2. Sign in with your registered mobile number and password.\n' +
    '3. Select your child and log daily prayers.\n\n' +
    'May Allah bless our children with steadfastness in Salah.';
  window.shareOnWhatsApp(text);
};
