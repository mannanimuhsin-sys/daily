const { db, withTransaction } = require('../db');
const { getNowInTimezone } = require('./parentRoutes');
const { DEFAULT_TIMEZONE } = require('../config');

function handleAdminRoutes(req, res, url, body) {
  if (!req.user || (req.user.role !== 'institute_admin' && req.user.role !== 'super_admin')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Institute Administrator access required.' }));
    return true;
  }

  const adminInstituteId = req.user.institute_id;
  const adminUserId = req.user.id;

  if (!adminInstituteId && req.user.role !== 'super_admin') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'No institute associated with this administrator.' }));
  }

  // 1. GET /api/admin/overview
  if (req.method === 'GET' && url.pathname === '/api/admin/overview') {
    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(adminInstituteId) || {};
    const nowInfo = getNowInTimezone(settings.timezone || DEFAULT_TIMEZONE);

    const totalStudents = db.prepare("SELECT COUNT(*) as count FROM students WHERE institute_id = ? AND account_status = 'active'").get(adminInstituteId).count;
    const totalClasses = db.prepare('SELECT COUNT(*) as count FROM classes WHERE institute_id = ? AND is_active = 1').get(adminInstituteId).count;
    const totalParents = db.prepare('SELECT COUNT(DISTINCT parent_user_id) as count FROM parent_student_links WHERE institute_id = ? AND is_active = 1').get(adminInstituteId).count;
    const totalRoutines = db.prepare('SELECT COUNT(*) as count FROM routines WHERE institute_id = ? AND is_active = 1').get(adminInstituteId).count;

    // Today's prayer records
    const todayRecords = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM daily_routine_records r
      JOIN routines rt ON r.routine_id = rt.id
      WHERE r.institute_id = ? AND r.activity_date = ? AND rt.is_prayer = 1
      GROUP BY status
    `).all(adminInstituteId, nowInfo.date);

    const statusCounts = { completed: 0, not_completed: 0, excused: 0, not_recorded: 0 };
    let recordedTotal = 0;
    todayRecords.forEach(r => {
      statusCounts[r.status] = r.count;
      recordedTotal += r.count;
    });

    const expectedPrayerRecords = totalStudents * 5;
    statusCounts.not_recorded = Math.max(0, expectedPrayerRecords - recordedTotal);

    // Recent corrections with reason
    const recentCorrections = db.prepare(`
      SELECT a.*, u.display_name as actor_name, s.student_name, rt.routine_name_ml, rt.routine_name_en, rec.activity_date
      FROM record_audit_logs a
      JOIN users u ON a.actor_user_id = u.id
      JOIN daily_routine_records rec ON a.record_id = rec.id
      JOIN students s ON rec.student_id = s.id
      JOIN routines rt ON rec.routine_id = rt.id
      WHERE a.institute_id = ? AND a.actor_role = 'institute_admin'
      ORDER BY a.action_timestamp DESC
      LIMIT 10
    `).all(adminInstituteId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      institute_id: adminInstituteId,
      today: nowInfo.date,
      counts: {
        totalStudents,
        totalClasses,
        totalParents,
        totalRoutines
      },
      todayPrayerStats: {
        expectedTotal: expectedPrayerRecords,
        ...statusCounts,
        completionRate: expectedPrayerRecords > 0 ? Math.round((statusCounts.completed / expectedPrayerRecords) * 100) : 0
      },
      recentCorrections
    }));
  }

  // 2. GET /api/admin/records
  if (req.method === 'GET' && url.pathname === '/api/admin/records') {
    const classId = url.searchParams.get('class_id');
    const studentId = url.searchParams.get('student_id');
    const date = url.searchParams.get('date');
    const routineId = url.searchParams.get('routine_id');
    const status = url.searchParams.get('status');

    let query = `
      SELECT r.*, s.student_name, s.admission_number, c.class_name, c.division, c.id AS class_id,
             rt.routine_name_ml, rt.routine_name_en, rt.is_prayer,
             u.display_name AS recorded_by_name
      FROM daily_routine_records r
      JOIN students s ON r.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN routines rt ON r.routine_id = rt.id
      JOIN users u ON r.recorded_by_user_id = u.id
      WHERE r.institute_id = ?
    `;
    const params = [adminInstituteId];

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }
    if (studentId) {
      query += ' AND r.student_id = ?';
      params.push(studentId);
    }
    if (date) {
      query += ' AND r.activity_date = ?';
      params.push(date);
    }
    if (routineId) {
      query += ' AND r.routine_id = ?';
      params.push(routineId);
    }
    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    query += ' ORDER BY r.activity_date DESC, c.class_number ASC, s.student_name ASC, rt.display_order ASC LIMIT 200';

    const records = db.prepare(query).all(...params);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ records }));
  }

  // 3. POST /api/admin/correct-record
  if (req.method === 'POST' && url.pathname === '/api/admin/correct-record') {
    const { student_id, routine_id, activity_date, new_status, reason } = body || {};

    if (!student_id || !routine_id || !activity_date || !new_status) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'student_id, routine_id, activity_date, and new_status are required.' }));
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'A mandatory correction reason is required for administrative updates.' }));
    }

    const validStatuses = ['completed', 'not_completed', 'not_recorded', 'excused'];
    if (!validStatuses.includes(new_status)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }));
    }

    // Verify student belongs to administrator's institute
    const student = db.prepare('SELECT * FROM students WHERE id = ? AND institute_id = ?').get(student_id, adminInstituteId);
    if (!student) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized: Student does not belong to your institute.' }));
    }

    // Verify routine belongs to administrator's institute
    const routine = db.prepare('SELECT * FROM routines WHERE id = ? AND institute_id = ?').get(routine_id, adminInstituteId);
    if (!routine) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Routine not found in your institute.' }));
    }

    const now = new Date().toISOString();

    const result = withTransaction(() => {
      const existing = db.prepare(`
        SELECT * FROM daily_routine_records
        WHERE student_id = ? AND routine_id = ? AND activity_date = ? AND institute_id = ?
      `).get(student_id, routine_id, activity_date, adminInstituteId);

      const previousStatus = existing ? existing.status : 'not_recorded';
      let recordId = existing ? existing.id : 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const newVersion = existing ? (existing.version + 1) : 1;

      if (existing) {
        db.prepare(`
          UPDATE daily_routine_records
          SET status = ?, recorded_by_user_id = ?, recorded_by_role = 'institute_admin',
              updated_at = ?, version = ?
          WHERE id = ?
        `).run(new_status, adminUserId, now, newVersion, existing.id);
      } else {
        db.prepare(`
          INSERT INTO daily_routine_records (
            id, institute_id, student_id, routine_id, activity_date,
            status, recorded_by_user_id, recorded_by_role, created_at, updated_at, version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'institute_admin', ?, ?, ?)
        `).run(recordId, adminInstituteId, student_id, routine_id, activity_date, new_status, adminUserId, now, now, 1);
      }

      // Record immutable audit log with mandatory reason
      const auditId = 'aud_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      db.prepare(`
        INSERT INTO record_audit_logs (
          id, institute_id, record_id, actor_user_id, actor_role,
          previous_status, new_status, reason, action_timestamp
        ) VALUES (?, ?, ?, ?, 'institute_admin', ?, ?, ?, ?)
      `).run(auditId, adminInstituteId, recordId, adminUserId, previousStatus, new_status, reason.trim(), now);

      return {
        record_id: recordId,
        student_id,
        routine_id,
        activity_date,
        previous_status: previousStatus,
        new_status,
        reason: reason.trim(),
        action_timestamp: now,
        version: newVersion
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      message: 'Record successfully corrected with audit log.',
      data: result
    }));
  }

  // 4. GET /api/admin/audit-logs
  if (req.method === 'GET' && url.pathname === '/api/admin/audit-logs') {
    const recordId = url.searchParams.get('record_id');
    const studentId = url.searchParams.get('student_id');

    let query = `
      SELECT a.*, u.display_name AS actor_name,
             rec.activity_date, s.student_name, rt.routine_name_ml, rt.routine_name_en
      FROM record_audit_logs a
      JOIN users u ON a.actor_user_id = u.id
      JOIN daily_routine_records rec ON a.record_id = rec.id
      JOIN students s ON rec.student_id = s.id
      JOIN routines rt ON rec.routine_id = rt.id
      WHERE a.institute_id = ?
    `;
    const params = [adminInstituteId];

    if (recordId) {
      query += ' AND a.record_id = ?';
      params.push(recordId);
    }
    if (studentId) {
      query += ' AND rec.student_id = ?';
      params.push(studentId);
    }

    query += ' ORDER BY a.action_timestamp DESC LIMIT 100';

    const logs = db.prepare(query).all(...params);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ audit_logs: logs }));
  }

  // 5. Classes Management: GET & POST /api/admin/classes
  if (req.method === 'GET' && url.pathname === '/api/admin/classes') {
    const classes = db.prepare(`
      SELECT c.*, COUNT(s.id) AS student_count
      FROM classes c
      LEFT JOIN students s ON c.id = s.class_id AND s.account_status = 'active'
      WHERE c.institute_id = ?
      GROUP BY c.id
      ORDER BY c.class_number ASC, c.division ASC
    `).all(adminInstituteId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ classes }));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/classes') {
    const { class_number, class_name, division } = body || {};
    const cNum = parseInt(class_number, 10);
    if (!cNum || cNum < 1 || cNum > 12 || !division) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Class number must be between 1 and 12, with a valid division.' }));
    }

    const classId = `cls_${adminInstituteId}_${cNum}${division.trim().toUpperCase()}`;
    const name = class_name ? class_name.trim() : `Class ${cNum}`;

    try {
      db.prepare(`
        INSERT INTO classes (id, institute_id, class_number, class_name, division, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(classId, adminInstituteId, cNum, name, division.trim().toUpperCase());

      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: 'Class added successfully.', class_id: classId }));
    } catch (e) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Class with this number and division already exists.' }));
    }
  }

  // 6. Routines Management: GET & POST /api/admin/routines
  if (req.method === 'GET' && url.pathname === '/api/admin/routines') {
    const routines = db.prepare(`
      SELECT r.*,
             GROUP_CONCAT(COALESCE(c.class_name || ' ' || c.division, 'All Classes')) AS assigned_classes_text,
             MAX(a.applies_to_all_classes) as applies_to_all
      FROM routines r
      LEFT JOIN routine_class_assignments a ON r.id = a.routine_id
      LEFT JOIN classes c ON a.class_id = c.id
      WHERE r.institute_id = ?
      GROUP BY r.id
      ORDER BY r.is_prayer DESC, r.display_order ASC
    `).all(adminInstituteId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ routines }));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/routines') {
    const { routine_name_ml, routine_name_en, category, class_ids, applies_to_all_classes } = body || {};
    if (!routine_name_ml || !category) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'routine_name_ml and category are required.' }));
    }

    const routineId = 'rt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const appliesAll = (applies_to_all_classes === true || applies_to_all_classes === 1 || (!class_ids || class_ids.length === 0)) ? 1 : 0;

    withTransaction(() => {
      // Get next display order
      const maxOrder = db.prepare('SELECT MAX(display_order) as max_ord FROM routines WHERE institute_id = ?').get(adminInstituteId).max_ord || 5;

      db.prepare(`
        INSERT INTO routines (
          id, institute_id, routine_name_ml, routine_name_en, category,
          is_prayer, is_active, display_order, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, 1, ?, datetime('now'))
      `).run(routineId, adminInstituteId, routine_name_ml.trim(), routine_name_en ? routine_name_en.trim() : null, category, maxOrder + 1);

      if (appliesAll === 1) {
        db.prepare(`
          INSERT INTO routine_class_assignments (id, institute_id, routine_id, class_id, applies_to_all_classes)
          VALUES (?, ?, ?, null, 1)
        `).run(`asg_${routineId}_all`, adminInstituteId, routineId);
      } else if (Array.isArray(class_ids)) {
        const insertAsg = db.prepare(`
          INSERT INTO routine_class_assignments (id, institute_id, routine_id, class_id, applies_to_all_classes)
          VALUES (?, ?, ?, ?, 0)
        `);
        class_ids.forEach((cId, idx) => {
          insertAsg.run(`asg_${routineId}_${idx}`, adminInstituteId, routineId, cId);
        });
      }
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Custom routine created successfully.', routine_id: routineId }));
  }

  // 7. Students & Parent Links: GET /api/admin/students
  if (req.method === 'GET' && url.pathname === '/api/admin/students') {
    const students = db.prepare(`
      SELECT s.*, c.class_name, c.division, c.class_number,
             GROUP_CONCAT(u.display_name || ' (' || u.mobile_number || ')') AS parents_info,
             GROUP_CONCAT(u.id) AS parent_ids
      FROM students s
      JOIN classes c ON s.class_id = c.id
      LEFT JOIN parent_student_links l ON s.id = l.student_id AND l.is_active = 1
      LEFT JOIN users u ON l.parent_user_id = u.id
      WHERE s.institute_id = ?
      GROUP BY s.id
      ORDER BY c.class_number ASC, s.student_name ASC
    `).all(adminInstituteId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ students }));
  }

  // 8. Settings: GET & POST /api/admin/settings
  if (req.method === 'GET' && url.pathname === '/api/admin/settings') {
    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(adminInstituteId) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ settings }));
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/settings') {
    const {
      parent_recording_enabled,
      student_read_only_enabled,
      record_edit_deadline,
      allowed_backdate_days,
      timezone,
      excused_status_enabled
    } = body || {};

    db.prepare(`
      INSERT INTO institute_settings (
        institute_id, parent_recording_enabled, student_read_only_enabled,
        record_edit_deadline, allowed_backdate_days, timezone, excused_status_enabled
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(institute_id) DO UPDATE SET
        parent_recording_enabled = excluded.parent_recording_enabled,
        student_read_only_enabled = excluded.student_read_only_enabled,
        record_edit_deadline = excluded.record_edit_deadline,
        allowed_backdate_days = excluded.allowed_backdate_days,
        timezone = excluded.timezone,
        excused_status_enabled = excluded.excused_status_enabled
    `).run(
      adminInstituteId,
      parent_recording_enabled ? 1 : 0,
      student_read_only_enabled ? 1 : 0,
      record_edit_deadline || null,
      allowed_backdate_days !== undefined ? parseInt(allowed_backdate_days, 10) : 7,
      timezone || 'Asia/Kolkata',
      excused_status_enabled ? 1 : 0
    );

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Institute settings updated successfully.' }));
  }

  // 9. Export Class / Student Reports: GET /api/admin/reports/export
  if (req.method === 'GET' && url.pathname === '/api/admin/reports/export') {
    const classId = url.searchParams.get('class_id');
    const startDate = url.searchParams.get('start_date');
    const endDate = url.searchParams.get('end_date');
    const format = url.searchParams.get('format') || 'json';

    let query = `
      SELECT r.activity_date, s.student_name, s.admission_number, c.class_name, c.division,
             rt.routine_name_ml, rt.routine_name_en, rt.is_prayer,
             r.status, r.recorded_by_role, u.display_name AS recorded_by_name, r.updated_at
      FROM daily_routine_records r
      JOIN students s ON r.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      JOIN routines rt ON r.routine_id = rt.id
      JOIN users u ON r.recorded_by_user_id = u.id
      WHERE r.institute_id = ?
    `;
    const params = [adminInstituteId];

    if (classId) {
      query += ' AND s.class_id = ?';
      params.push(classId);
    }
    if (startDate) {
      query += ' AND r.activity_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      query += ' AND r.activity_date <= ?';
      params.push(endDate);
    }

    query += ' ORDER BY r.activity_date DESC, c.class_number ASC, s.student_name ASC, rt.display_order ASC';

    const records = db.prepare(query).all(...params);

    if (format === 'csv') {
      const headers = ['Date', 'Student Name', 'Admission No', 'Class', 'Routine (ML)', 'Routine (EN)', 'Status', 'Recorded By Role', 'Recorded By User', 'Updated At'];
      const csvRows = [headers.join(',')];
      records.forEach(r => {
        csvRows.push([
          `"${r.activity_date}"`,
          `"${r.student_name}"`,
          `"${r.admission_number || ''}"`,
          `"${r.class_name} ${r.division}"`,
          `"${r.routine_name_ml}"`,
          `"${r.routine_name_en || ''}"`,
          `"${r.status}"`,
          `"${r.recorded_by_role}"`,
          `"${r.recorded_by_name}"`,
          `"${r.updated_at}"`
        ].join(','));
      });
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="prayer_tracker_report.csv"'
      });
      return res.end(csvRows.join('\n'));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ report: records }));
  }

  return false;
}

module.exports = { handleAdminRoutes };
