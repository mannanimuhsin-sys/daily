const { db } = require('../db');
const { getNowInTimezone } = require('./parentRoutes');
const { DEFAULT_TIMEZONE } = require('../config');

function handleStudentRoutes(req, res, url, body) {
  // If a student tries ANY mutation (POST, PUT, PATCH, DELETE), reject immediately with 403
  if (req.user && req.user.role === 'student') {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Forbidden: Student accounts have strictly read-only permissions. Prayer records must be entered by authorized parents.'
      }));
      return true;
    }
  }

  // GET /api/student/my-progress
  if (req.method === 'GET' && url.pathname === '/api/student/my-progress') {
    if (!req.user || req.user.role !== 'student') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Student login required.' }));
    }

    const studentInstituteId = req.user.institute_id;
    const settings = db.prepare('SELECT * FROM institute_settings WHERE institute_id = ?').get(studentInstituteId) || {};

    if (settings.student_read_only_enabled === 0) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'Student viewing is disabled by your institute administrator.'
      }));
    }

    // Match student profile by matching display name or linked student profile in same institute
    let student = db.prepare(`
      SELECT s.*, c.class_name, c.division, c.class_number
      FROM students s
      JOIN classes c ON s.class_id = c.id
      WHERE s.institute_id = ? AND s.account_status = 'active'
      LIMIT 1
    `).get(studentInstituteId);

    // If student user has mobile number matching a student's admission or identifier
    const directMatch = db.prepare(`
      SELECT s.*, c.class_name, c.division, c.class_number
      FROM students s
      JOIN classes c ON s.class_id = c.id
      WHERE s.institute_id = ? AND s.student_name LIKE ?
    `).get(studentInstituteId, `%${req.user.display_name.split(' ')[0]}%`);

    if (directMatch) {
      student = directMatch;
    }

    if (!student) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Student profile not linked to this login account.' }));
    }

    const nowInfo = getNowInTimezone(settings.timezone || DEFAULT_TIMEZONE);
    const targetDate = url.searchParams.get('date') || nowInfo.date;

    // Fetch student's assigned routines
    const routines = db.prepare(`
      SELECT DISTINCT r.id, r.routine_name_ml, r.routine_name_en, r.category, r.is_prayer, r.display_order
      FROM routines r
      JOIN routine_class_assignments a ON r.id = a.routine_id
      WHERE r.institute_id = ?
        AND (a.class_id = ? OR a.applies_to_all_classes = 1)
        AND r.is_active = 1
      ORDER BY r.is_prayer DESC, r.display_order ASC
    `).all(studentInstituteId, student.class_id);

    // Fetch student's records for this date
    const records = db.prepare(`
      SELECT r.*, u.display_name as recorded_by_name
      FROM daily_routine_records r
      LEFT JOIN users u ON r.recorded_by_user_id = u.id
      WHERE r.student_id = ? AND r.activity_date = ? AND r.institute_id = ?
    `).all(student.id, targetDate, studentInstituteId);

    const recordMap = new Map();
    records.forEach(r => recordMap.set(r.routine_id, r));

    const prayers = [];
    const customRoutines = [];
    let completedCount = 0;

    routines.forEach(rt => {
      const rec = recordMap.get(rt.id);
      const status = rec ? rec.status : 'not_recorded';
      const item = {
        routine_name_ml: rt.routine_name_ml,
        routine_name_en: rt.routine_name_en,
        category: rt.category,
        is_prayer: rt.is_prayer === 1,
        status,
        recorded_by: rec ? (rec.recorded_by_role === 'institute_admin' ? 'Administrator (Corrected)' : 'Parent Recorded') : 'Not Recorded',
        updated_at: rec ? rec.updated_at : null
      };

      if (rt.is_prayer === 1) {
        prayers.push(item);
        if (status === 'completed') completedCount++;
      } else {
        customRoutines.push(item);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      read_only: true,
      student: {
        id: student.id,
        name: student.student_name,
        admission_number: student.admission_number,
        class: `${student.class_name} - ${student.division}`
      },
      date: targetDate,
      prayers,
      custom_routines: customRoutines,
      summary: {
        completed_prayers: completedCount,
        total_prayers: prayers.length
      }
    }));
  }

  return false;
}

module.exports = { handleStudentRoutes };
