const { db, withTransaction } = require('../db');
const { DEFAULT_ALLOWED_BACKDATE_DAYS, DEFAULT_TIMEZONE } = require('../config');

// Helper to get current date/time in timezone
function getNowInTimezone(timezone = DEFAULT_TIMEZONE) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(new Date());
    const map = {};
    parts.forEach(p => (map[p.type] = p.value));
    return {
      date: `${map.year}-${map.month}-${map.day}`,
      time: `${map.hour}:${map.minute}`,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    const now = new Date();
    return {
      date: now.toISOString().substring(0, 10),
      time: now.toTimeString().substring(0, 5),
      timestamp: now.toISOString()
    };
  }
}

// Check if a date is within allowed backdate window and deadline
function validateDatePermissions(settings, targetDate) {
  const tz = settings?.timezone || DEFAULT_TIMEZONE;
  const current = getNowInTimezone(tz);

  if (targetDate > current.date) {
    return { allowed: false, reason: 'Future dates cannot be recorded or edited.' };
  }

  const allowedBackdate = settings?.allowed_backdate_days ?? DEFAULT_ALLOWED_BACKDATE_DAYS;
  const targetTime = new Date(targetDate + 'T00:00:00Z').getTime();
  const currentTime = new Date(current.date + 'T00:00:00Z').getTime();
  const diffDays = Math.floor((currentTime - targetTime) / (1000 * 60 * 60 * 24));

  if (diffDays > allowedBackdate) {
    return {
      allowed: false,
      reason: `Editing for this date is closed (exceeds ${allowedBackdate} allowed backdate days).`
    };
  }

  // If target date is today, check daily submission deadline
  if (targetDate === current.date && settings?.record_edit_deadline) {
    if (current.time > settings.record_edit_deadline) {
      return {
        allowed: false,
        reason: `Daily submission deadline (${settings.record_edit_deadline}) has passed for today.`
      };
    }
  }

  return { allowed: true, reason: null };
}

function handleParentRoutes(req, res, url, body) {
  if (!req.user || req.user.role !== 'parent') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Parent access required.' }));
    return true;
  }

  const parentUserId = req.user.id;
  const parentInstituteId = req.user.institute_id;

  // 1. GET /api/parent/children
  if (req.method === 'GET' && url.pathname === '/api/parent/children') {
    const children = db.prepare(`
      SELECT s.id, s.student_name, s.admission_number, s.account_status,
             c.id AS class_id, c.class_name, c.division, c.class_number
      FROM parent_student_links l
      JOIN students s ON l.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      WHERE l.parent_user_id = ?
        AND l.is_active = 1
        AND l.institute_id = ?
        AND s.account_status = 'active'
      ORDER BY c.class_number ASC, s.student_name ASC
    `).all(parentUserId, parentInstituteId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ children }));
  }

  // 2. GET /api/parent/child-data
  if (req.method === 'GET' && url.pathname === '/api/parent/child-data') {
    const studentId = url.searchParams.get('student_id');
    if (!studentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'student_id is required.' }));
    }

    // Verify parent is authorized for this child
    const link = db.prepare(`
      SELECT l.*, s.student_name, s.admission_number, s.class_id,
             c.class_name, c.division, c.class_number
      FROM parent_student_links l
      JOIN students s ON l.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      WHERE l.parent_user_id = ? AND l.student_id = ? AND l.is_active = 1 AND l.institute_id = ?
    `).get(parentUserId, studentId, parentInstituteId);

    if (!link) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: You are not authorized to view this student.' }));
    }

    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(parentInstituteId) || {};
    const tz = settings.timezone || DEFAULT_TIMEZONE;
    const nowInfo = getNowInTimezone(tz);

    const targetDate = url.searchParams.get('date') || nowInfo.date;
    const dateCheck = validateDatePermissions(settings, targetDate);

    // Fetch routines applicable to this student's class
    const routines = db.prepare(`
      SELECT DISTINCT r.id, r.routine_name_ml, r.routine_name_en, r.category,
                      r.is_prayer, r.display_order, r.is_active
      FROM routines r
      JOIN routine_class_assignments a ON r.id = a.routine_id
      WHERE r.institute_id = ?
        AND (a.class_id = ? OR a.applies_to_all_classes = 1)
        AND (r.is_active = 1 OR EXISTS (
          SELECT 1 FROM daily_routine_records rec
          WHERE rec.routine_id = r.id AND rec.student_id = ? AND rec.activity_date = ?
        ))
      ORDER BY r.is_prayer DESC, r.display_order ASC
    `).all(parentInstituteId, link.class_id, studentId, targetDate);

    // Fetch existing records for this student and date
    const records = db.prepare(`
      SELECT r.*, u.display_name AS recorded_by_name
      FROM daily_routine_records r
      LEFT JOIN users u ON r.recorded_by_user_id = u.id
      WHERE r.student_id = ? AND r.activity_date = ? AND r.institute_id = ?
    `).all(studentId, targetDate, parentInstituteId);

    const recordMap = new Map();
    records.forEach(r => recordMap.set(r.routine_id, r));

    const prayers = [];
    const customRoutines = [];

    let completedPrayers = 0;
    let notCompletedPrayers = 0;
    let excusedPrayers = 0;
    let notRecordedPrayers = 0;

    let completedCustom = 0;
    let totalCustom = 0;

    routines.forEach(rt => {
      const rec = recordMap.get(rt.id);
      const status = rec ? rec.status : 'not_recorded';
      const item = {
        routine_id: rt.id,
        routine_name_ml: rt.routine_name_ml,
        routine_name_en: rt.routine_name_en,
        category: rt.category,
        is_prayer: rt.is_prayer === 1,
        status: status,
        record_id: rec ? rec.id : null,
        recorded_by_role: rec ? rec.recorded_by_role : null,
        recorded_by_name: rec ? rec.recorded_by_name : null,
        updated_at: rec ? rec.updated_at : null,
        version: rec ? rec.version : 0,
        is_admin_corrected: rec ? rec.recorded_by_role === 'institute_admin' : false
      };

      if (rt.is_prayer === 1) {
        prayers.push(item);
        if (status === 'completed') completedPrayers++;
        else if (status === 'not_completed') notCompletedPrayers++;
        else if (status === 'excused') excusedPrayers++;
        else notRecordedPrayers++;
      } else {
        customRoutines.push(item);
        totalCustom++;
        if (status === 'completed') completedCustom++;
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      student: {
        id: link.student_id,
        student_name: link.student_name,
        admission_number: link.admission_number,
        class_id: link.class_id,
        class_name: link.class_name,
        division: link.division
      },
      date: targetDate,
      is_editable: dateCheck.allowed && (settings.parent_recording_enabled === 1),
      editable_reason: !settings.parent_recording_enabled
        ? 'Parent recording is currently disabled by the institute administrator.'
        : dateCheck.reason,
      settings: {
        parent_recording_enabled: settings.parent_recording_enabled === 1,
        excused_status_enabled: settings.excused_status_enabled === 1,
        allowed_backdate_days: settings.allowed_backdate_days,
        record_edit_deadline: settings.record_edit_deadline
      },
      prayers,
      custom_routines: customRoutines,
      progress: {
        prayers: {
          total: prayers.length,
          completed: completedPrayers,
          not_completed: notCompletedPrayers,
          excused: excusedPrayers,
          not_recorded: notRecordedPrayers,
          percentage: prayers.length > 0 ? Math.round((completedPrayers / prayers.length) * 100) : 0
        },
        custom_routines: {
          total: totalCustom,
          completed: completedCustom,
          percentage: totalCustom > 0 ? Math.round((completedCustom / totalCustom) * 100) : 0
        }
      }
    }));
  }

  // 3. POST /api/parent/record
  if (req.method === 'POST' && url.pathname === '/api/parent/record') {
    const { student_id, routine_id, activity_date, status } = body || {};

    if (!student_id || !routine_id || !activity_date || !status) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing required fields: student_id, routine_id, activity_date, status.' }));
    }

    const validStatuses = ['completed', 'not_completed', 'not_recorded', 'excused'];
    if (!validStatuses.includes(status)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }));
    }

    // 1. Verify parent authorization for student
    const link = db.prepare(`
      SELECT l.*, s.class_id FROM parent_student_links l
      JOIN students s ON l.student_id = s.id
      WHERE l.parent_user_id = ? AND l.student_id = ? AND l.is_active = 1 AND l.institute_id = ?
    `).get(parentUserId, student_id, parentInstituteId);

    if (!link) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: You are not authorized to submit records for this student.' }));
    }

    // 2. Verify institute settings and date restrictions
    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(parentInstituteId) || {};
    if (settings.parent_recording_enabled === 0) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Parent recording is disabled by institute policy.' }));
    }

    if (status === 'excused' && settings.excused_status_enabled === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Excused status is disabled by institute policy.' }));
    }

    const dateCheck = validateDatePermissions(settings, activity_date);
    if (!dateCheck.allowed) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: dateCheck.reason }));
    }

    // 3. Verify routine exists, is active, and applies to this student's class
    const assignment = db.prepare(`
      SELECT r.id, r.is_prayer, r.routine_name_ml, r.routine_name_en
      FROM routines r
      JOIN routine_class_assignments a ON r.id = a.routine_id
      WHERE r.id = ? AND r.institute_id = ? AND r.is_active = 1
        AND (a.class_id = ? OR a.applies_to_all_classes = 1)
    `).get(routine_id, parentInstituteId, link.class_id);

    if (!assignment) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Routine is not active or not assigned to the student\'s class.' }));
    }

    const now = new Date().toISOString();

    // 4. Atomic transaction: Record update/insert + Audit log
    const savedRecord = withTransaction(() => {
      const existing = db.prepare(`
        SELECT * FROM daily_routine_records
        WHERE student_id = ? AND routine_id = ? AND activity_date = ?
      `).get(student_id, routine_id, activity_date);

      let recordId = existing ? existing.id : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const previousStatus = existing ? existing.status : 'not_recorded';
      const newVersion = existing ? (existing.version + 1) : 1;

      if (existing) {
        db.prepare(`
          UPDATE daily_routine_records
          SET status = ?, recorded_by_user_id = ?, recorded_by_role = 'parent',
              updated_at = ?, version = ?
          WHERE id = ?
        `).run(status, parentUserId, now, newVersion, existing.id);
      } else {
        db.prepare(`
          INSERT INTO daily_routine_records (
            id, institute_id, student_id, routine_id, activity_date,
            status, recorded_by_user_id, recorded_by_role, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'parent', ?, ?, ?)
        `).run(recordId, parentInstituteId, student_id, routine_id, activity_date, status, parentUserId, now, now, 1);
      }

      // Record immutable audit log
      const auditId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      db.prepare(`
        INSERT INTO record_audit_logs (
          id, institute_id, record_id, actor_user_id, actor_role,
          previous_status, new_status, reason, action_timestamp
        ) VALUES (?, ?, ?, ?, 'parent', ?, ?, 'Parent daily entry', ?)
      `).run(auditId, parentInstituteId, recordId, parentUserId, previousStatus, status, now);

      return {
        id: recordId,
        student_id,
        routine_id,
        activity_date,
        status,
        previous_status: previousStatus,
        recorded_by_role: 'parent',
        updated_at: now,
        version: newVersion
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      message: 'Prayer / routine status saved successfully.',
      record: savedRecord
    }));
  }

  // 4. GET /api/parent/reports
  if (req.method === 'GET' && url.pathname === '/api/parent/reports') {
    const studentId = url.searchParams.get('student_id');
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    if (!studentId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'student_id is required.' }));
    }

    // Verify parent authorization
    const link = db.prepare(`
      SELECT l.*, s.student_name, s.admission_number, c.class_name, c.division
      FROM parent_student_links l
      JOIN students s ON l.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      WHERE l.parent_user_id = ? AND l.student_id = ? AND l.is_active = 1 AND l.institute_id = ?
    `).get(parentUserId, studentId, parentInstituteId);

    if (!link) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: You are not authorized to access this student\'s reports.' }));
    }

    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(parentInstituteId) || {};
    const nowInfo = getNowInTimezone(settings.timezone || DEFAULT_TIMEZONE);

    // Calculate start date
    const targetDateObj = new Date(nowInfo.date + 'T00:00:00Z');
    targetDateObj.setUTCDate(targetDateObj.getUTCDate() - days);
    const startDate = targetDateObj.toISOString().substring(0, 10);

    // Fetch records in date range
    const records = db.prepare(`
      SELECT r.activity_date, r.status, r.recorded_by_role,
             rt.routine_name_ml, rt.routine_name_en, rt.is_prayer
      FROM daily_routine_records r
      JOIN routines rt ON r.routine_id = rt.id
      WHERE r.student_id = ? AND r.institute_id = ?
        AND r.activity_date >= ? AND r.activity_date <= ?
      ORDER BY r.activity_date DESC, rt.display_order ASC
    `).all(studentId, parentInstituteId, startDate, nowInfo.date);

    // Group by date
    const byDate = {};
    let totalCompletedPrayers = 0;
    let totalMissedPrayers = 0;
    let totalExcusedPrayers = 0;

    records.forEach(r => {
      if (!byDate[r.activity_date]) {
        byDate[r.activity_date] = {
          date: r.activity_date,
          prayers: [],
          custom_routines: []
        };
      }
      if (r.is_prayer === 1) {
        byDate[r.activity_date].prayers.push(r);
        if (r.status === 'completed') totalCompletedPrayers++;
        else if (r.status === 'not_completed') totalMissedPrayers++;
        else if (r.status === 'excused') totalExcusedPrayers++;
      } else {
        byDate[r.activity_date].custom_routines.push(r);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      student: {
        id: link.student_id,
        name: link.student_name,
        admission_number: link.admission_number,
        class: `${link.class_name} - ${link.division}`
      },
      range: {
        start_date: startDate,
        end_date: nowInfo.date,
        days_requested: days
      },
      summary: {
        completed_prayers: totalCompletedPrayers,
        missed_prayers: totalMissedPrayers,
        excused_prayers: totalExcusedPrayers,
        recorded_days_count: Object.keys(byDate).length
      },
      history: Object.values(byDate)
    }));
  }

  return false;
}

module.exports = { handleParentRoutes, validateDatePermissions, getNowInTimezone };
