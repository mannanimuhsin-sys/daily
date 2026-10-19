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

      ['adminOverviewTab', 'adminRecordsTab', 'adminRoutinesTab', 'adminClassesTab', 'adminSettingsTab'].forEach(tId => {
        document.getElementById(tId).style.display = tId === `admin${capitalize(tab)}Tab` ? 'block' : 'none';
      });

      if (tab === 'overview') loadAdminOverview();
      else if (tab === 'records') loadAdminRecords();
      else if (tab === 'routines') loadAdminRoutines();
      else if (tab === 'classes') loadAdminClassesAndStudents();
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

// Start app
initSession();
