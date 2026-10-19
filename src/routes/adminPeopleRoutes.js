/**
 * Admin People Routes — Parents & Mentors Management
 * All routes are restricted to institute_admin (or super_admin).
 * Every operation is scoped to the admin's own institute_id.
 */

const { db, withTransaction } = require('../db');
const { hashPassword } = require('../auth');

// ─── helpers ──────────────────────────────────────────────────────────────────

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
  return true;
}

// ─── main handler ─────────────────────────────────────────────────────────────

function handleAdminPeopleRoutes(req, res, url, body) {
  // Guard: institute admin or super admin only
  if (!req.user || (req.user.role !== 'institute_admin' && req.user.role !== 'super_admin')) {
    json(res, 403, { error: 'Forbidden: Institute Administrator access required.' });
    return true;
  }

  const adminInstituteId = req.user.institute_id;
  const adminUserId      = req.user.id;
  const p                = url.pathname;
  const m                = req.method;

  if (!adminInstituteId) {
    json(res, 400, { error: 'No institute associated with this administrator.' });
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PARENTS
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/admin/parents — list all parents with linked student counts
  if (m === 'GET' && p === '/api/admin/parents') {
    const search = url.searchParams.get('search') || '';
    const searchLike = `%${search}%`;

    const parents = db.prepare(`
      SELECT
        u.id, u.display_name, u.mobile_number, u.account_status, u.created_at,
        COUNT(DISTINCT psl.student_id) AS student_count
      FROM users u
      LEFT JOIN parent_student_links psl
        ON u.id = psl.parent_user_id AND psl.is_active = 1
      WHERE u.institute_id = ? AND u.role = 'parent'
        AND (u.display_name LIKE ? OR u.mobile_number LIKE ?)
      GROUP BY u.id
      ORDER BY u.display_name ASC
    `).all(adminInstituteId, searchLike, searchLike);

    return json(res, 200, { parents });
  }

  // GET /api/admin/parents/:id — parent detail with linked students
  if (m === 'GET' && p.startsWith('/api/admin/parents/')) {
    const parentId = p.split('/')[4];
    const parent = db.prepare(
      'SELECT id, display_name, mobile_number, account_status, created_at FROM users WHERE id = ? AND institute_id = ? AND role = \'parent\''
    ).get(parentId, adminInstituteId);

    if (!parent) return json(res, 404, { error: 'Parent not found.' });

    const students = db.prepare(`
      SELECT s.id, s.student_name, s.admission_number, s.account_status,
             c.class_name, c.division, c.class_number,
             psl.id AS link_id, psl.created_at AS linked_at
      FROM parent_student_links psl
      JOIN students s ON psl.student_id = s.id
      JOIN classes c  ON s.class_id = c.id
      WHERE psl.parent_user_id = ? AND psl.institute_id = ? AND psl.is_active = 1
      ORDER BY c.class_number ASC, s.student_name ASC
    `).all(parentId, adminInstituteId);

    return json(res, 200, { parent, students });
  }

  // POST /api/admin/parents — create parent + students in one transaction
  if (m === 'POST' && p === '/api/admin/parents') {
    const { parent_mobile, parent_name, initial_password, students: studs } = body || {};

    if (!parent_mobile || !parent_name) {
      return json(res, 400, { error: 'parent_mobile and parent_name are required.' });
    }
    if (!initial_password || initial_password.length < 6) {
      return json(res, 400, { error: 'initial_password must be at least 6 characters.' });
    }
    if (!Array.isArray(studs) || studs.length === 0) {
      return json(res, 400, { error: 'At least one student entry is required.' });
    }

    // Validate each student entry
    for (let i = 0; i < studs.length; i++) {
      const s = studs[i];
      if (!s.student_name || !s.register_number || !s.class_id) {
        return json(res, 400, { error: `Student row ${i + 1}: student_name, register_number, and class_id are required.` });
      }
    }

    // Check if parent already exists by mobile (across ALL institutes)
    const existingUser = db.prepare('SELECT * FROM users WHERE mobile_number = ?').get(parent_mobile.trim());

    if (existingUser && existingUser.role !== 'parent') {
      return json(res, 409, { error: 'This mobile number is registered as another role. Cannot create a parent account.' });
    }
    if (existingUser && existingUser.institute_id !== adminInstituteId) {
      return json(res, 409, { error: 'This mobile number belongs to a parent in a different institute.' });
    }

    // Check register number uniqueness for each student within this institute
    for (const s of studs) {
      const dup = db.prepare(
        'SELECT id FROM students WHERE admission_number = ? AND institute_id = ?'
      ).get(s.register_number.trim(), adminInstituteId);
      if (dup) {
        return json(res, 409, { error: `Register number "${s.register_number}" is already in use within this institute.` });
      }

      // Verify class belongs to this institute
      const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND institute_id = ? AND is_active = 1').get(s.class_id, adminInstituteId);
      if (!cls) {
        return json(res, 400, { error: `Class ID "${s.class_id}" not found in your institute.` });
      }
    }

    const now = new Date().toISOString();

    const result = withTransaction(() => {
      let parentUserId;
      let isExisting = false;

      if (existingUser) {
        // Parent already exists in this institute — just add students
        parentUserId = existingUser.id;
        isExisting   = true;
      } else {
        // Create new parent user
        parentUserId = uid('usr_parent');
        db.prepare(`
          INSERT INTO users (id, authentication_user_id, display_name, mobile_number, password_hash, role, institute_id, account_status, created_at)
          VALUES (?, ?, ?, ?, ?, 'parent', ?, 'active', ?)
        `).run(
          parentUserId,
          'auth_' + parentUserId,
          parent_name.trim(),
          parent_mobile.trim(),
          hashPassword(initial_password),
          adminInstituteId,
          now
        );
      }

      const createdStudents = [];

      for (const s of studs) {
        const studentId = uid('stu');
        db.prepare(`
          INSERT INTO students (id, institute_id, class_id, student_name, admission_number, account_status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?)
        `).run(studentId, adminInstituteId, s.class_id, s.student_name.trim(), s.register_number.trim(), now);

        const linkId = uid('psl');
        db.prepare(`
          INSERT INTO parent_student_links (id, institute_id, parent_user_id, student_id, is_active, authorized_by, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(linkId, adminInstituteId, parentUserId, studentId, adminUserId, now);

        createdStudents.push({ student_id: studentId, link_id: linkId });
      }

      return { parent_user_id: parentUserId, is_existing: isExisting, students: createdStudents };
    });

    return json(res, 201, {
      message: result.is_existing
        ? `Students added to existing parent account successfully.`
        : `Parent account created and students linked successfully.`,
      data: result
    });
  }

  // POST /api/admin/parents/:id/add-students — add more students to existing parent
  if (m === 'POST' && p.match(/^\/api\/admin\/parents\/[^/]+\/add-students$/)) {
    const parentId = p.split('/')[4];
    const { students: studs } = body || {};

    const parent = db.prepare(
      'SELECT id FROM users WHERE id = ? AND institute_id = ? AND role = \'parent\''
    ).get(parentId, adminInstituteId);
    if (!parent) return json(res, 404, { error: 'Parent not found.' });

    if (!Array.isArray(studs) || studs.length === 0) {
      return json(res, 400, { error: 'At least one student entry is required.' });
    }

    for (let i = 0; i < studs.length; i++) {
      const s = studs[i];
      if (!s.student_name || !s.register_number || !s.class_id) {
        return json(res, 400, { error: `Student row ${i + 1}: all fields are required.` });
      }
      const dup = db.prepare('SELECT id FROM students WHERE admission_number = ? AND institute_id = ?').get(s.register_number.trim(), adminInstituteId);
      if (dup) {
        return json(res, 409, { error: `Register number "${s.register_number}" already in use.` });
      }
      const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND institute_id = ? AND is_active = 1').get(s.class_id, adminInstituteId);
      if (!cls) return json(res, 400, { error: `Class "${s.class_id}" not found.` });
    }

    const now = new Date().toISOString();

    const result = withTransaction(() => {
      const created = [];
      for (const s of studs) {
        const studentId = uid('stu');
        db.prepare(`
          INSERT INTO students (id, institute_id, class_id, student_name, admission_number, account_status, created_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?)
        `).run(studentId, adminInstituteId, s.class_id, s.student_name.trim(), s.register_number.trim(), now);

        const linkId = uid('psl');
        db.prepare(`
          INSERT OR IGNORE INTO parent_student_links (id, institute_id, parent_user_id, student_id, is_active, authorized_by, created_at)
          VALUES (?, ?, ?, ?, 1, ?, ?)
        `).run(linkId, adminInstituteId, parentId, studentId, adminUserId, now);

        created.push(studentId);
      }
      return created;
    });

    return json(res, 201, { message: 'Students added to parent successfully.', student_ids: result });
  }

  // PATCH /api/admin/parents/:id — update parent name / status
  if (m === 'PATCH' && p.match(/^\/api\/admin\/parents\/[^/]+$/)) {
    const parentId = p.split('/')[4];
    const { display_name, account_status } = body || {};

    const parent = db.prepare(
      'SELECT id FROM users WHERE id = ? AND institute_id = ? AND role = \'parent\''
    ).get(parentId, adminInstituteId);
    if (!parent) return json(res, 404, { error: 'Parent not found.' });

    if (display_name) {
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), parentId);
    }
    if (account_status && ['active', 'disabled'].includes(account_status)) {
      db.prepare('UPDATE users SET account_status = ? WHERE id = ?').run(account_status, parentId);
    }

    return json(res, 200, { message: 'Parent updated successfully.' });
  }

  // POST /api/admin/parents/check-mobile — check if parent mobile exists in this institute
  if (m === 'POST' && p === '/api/admin/parents/check-mobile') {
    const { mobile } = body || {};
    if (!mobile) return json(res, 400, { error: 'mobile is required.' });

    const user = db.prepare('SELECT id, display_name, role, institute_id FROM users WHERE mobile_number = ?').get(mobile.trim());

    if (!user) return json(res, 200, { exists: false });

    if (user.role === 'parent' && user.institute_id === adminInstituteId) {
      // Fetch their current students
      const students = db.prepare(`
        SELECT s.student_name, s.admission_number, c.class_name, c.division
        FROM parent_student_links psl
        JOIN students s ON psl.student_id = s.id
        JOIN classes c ON s.class_id = c.id
        WHERE psl.parent_user_id = ? AND psl.is_active = 1
      `).all(user.id);

      return json(res, 200, {
        exists: true,
        same_institute: true,
        parent_id: user.id,
        display_name: user.display_name,
        existing_students: students
      });
    }

    return json(res, 200, {
      exists: true,
      same_institute: false,
      role: user.role,
      message: user.role !== 'parent'
        ? 'This number is registered under a different role.'
        : 'This parent belongs to another institute.'
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MENTORS
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/admin/mentors — list all mentors with assigned classes
  if (m === 'GET' && p === '/api/admin/mentors') {
    const search = url.searchParams.get('search') || '';
    const searchLike = `%${search}%`;

    const mentors = db.prepare(`
      SELECT mt.id, mt.display_name, mt.mobile_number, mt.account_status, mt.created_at,
             u.id AS user_id,
             GROUP_CONCAT(c.class_name || ' ' || c.division ORDER BY c.class_number ASC) AS assigned_classes_text,
             COUNT(mca.id) AS class_count
      FROM mentors mt
      JOIN users u ON mt.user_id = u.id
      LEFT JOIN mentor_class_assignments mca ON mt.id = mca.mentor_id
      LEFT JOIN classes c ON mca.class_id = c.id
      WHERE mt.institute_id = ?
        AND (mt.display_name LIKE ? OR mt.mobile_number LIKE ?)
      GROUP BY mt.id
      ORDER BY mt.display_name ASC
    `).all(adminInstituteId, searchLike, searchLike);

    return json(res, 200, { mentors });
  }

  // GET /api/admin/mentors/:id — mentor detail with class assignments
  if (m === 'GET' && p.match(/^\/api\/admin\/mentors\/[^/]+$/)) {
    const mentorId = p.split('/')[4];
    const mentor = db.prepare(
      'SELECT * FROM mentors WHERE id = ? AND institute_id = ?'
    ).get(mentorId, adminInstituteId);
    if (!mentor) return json(res, 404, { error: 'Mentor not found.' });

    const classes = db.prepare(`
      SELECT c.id, c.class_name, c.division, c.class_number, mca.assigned_at
      FROM mentor_class_assignments mca
      JOIN classes c ON mca.class_id = c.id
      WHERE mca.mentor_id = ? AND mca.institute_id = ?
      ORDER BY c.class_number ASC
    `).all(mentorId, adminInstituteId);

    return json(res, 200, { mentor, classes });
  }

  // POST /api/admin/mentors — create mentor with class assignments
  if (m === 'POST' && p === '/api/admin/mentors') {
    const { mentor_mobile, mentor_name, initial_password, class_ids } = body || {};

    if (!mentor_mobile || !mentor_name) {
      return json(res, 400, { error: 'mentor_mobile and mentor_name are required.' });
    }
    if (!initial_password || initial_password.length < 6) {
      return json(res, 400, { error: 'initial_password must be at least 6 characters.' });
    }
    if (!Array.isArray(class_ids) || class_ids.length === 0) {
      return json(res, 400, { error: 'At least one class assignment is required.' });
    }

    // Verify all class IDs belong to this institute
    for (const cId of class_ids) {
      const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND institute_id = ? AND is_active = 1').get(cId, adminInstituteId);
      if (!cls) return json(res, 400, { error: `Class ID "${cId}" not found in your institute.` });
    }

    const existingUser = db.prepare('SELECT * FROM users WHERE mobile_number = ?').get(mentor_mobile.trim());

    if (existingUser && existingUser.role !== 'mentor') {
      return json(res, 409, { error: 'This mobile number is registered under another role.' });
    }
    if (existingUser && existingUser.institute_id !== adminInstituteId) {
      return json(res, 409, { error: 'This mobile number belongs to a user in a different institute.' });
    }

    const existingMentor = existingUser
      ? db.prepare('SELECT id FROM mentors WHERE user_id = ? AND institute_id = ?').get(existingUser.id, adminInstituteId)
      : null;

    if (existingMentor) {
      return json(res, 409, { error: 'A mentor with this mobile number already exists. Use PATCH to edit their class assignments.' });
    }

    const now = new Date().toISOString();

    const result = withTransaction(() => {
      let userId;

      if (existingUser) {
        userId = existingUser.id;
      } else {
        userId = uid('usr_mentor');
        db.prepare(`
          INSERT INTO users (id, authentication_user_id, display_name, mobile_number, password_hash, role, institute_id, account_status, created_at)
          VALUES (?, ?, ?, ?, ?, 'mentor', ?, 'active', ?)
        `).run(userId, 'auth_' + userId, mentor_name.trim(), mentor_mobile.trim(), hashPassword(initial_password), adminInstituteId, now);
      }

      const mentorId = uid('mtr');
      db.prepare(`
        INSERT INTO mentors (id, institute_id, user_id, display_name, mobile_number, account_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
      `).run(mentorId, adminInstituteId, userId, mentor_name.trim(), mentor_mobile.trim(), now);

      const insertAsg = db.prepare(`
        INSERT OR IGNORE INTO mentor_class_assignments (id, institute_id, mentor_id, class_id, assigned_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      class_ids.forEach(cId => {
        insertAsg.run(uid('mca'), adminInstituteId, mentorId, cId, now);
      });

      return { mentor_id: mentorId, user_id: userId };
    });

    return json(res, 201, { message: 'Mentor account created and classes assigned successfully.', data: result });
  }

  // PATCH /api/admin/mentors/:id — update name / status / class assignments
  if (m === 'PATCH' && p.match(/^\/api\/admin\/mentors\/[^/]+$/)) {
    const mentorId = p.split('/')[4];
    const { display_name, account_status, class_ids } = body || {};

    const mentor = db.prepare('SELECT * FROM mentors WHERE id = ? AND institute_id = ?').get(mentorId, adminInstituteId);
    if (!mentor) return json(res, 404, { error: 'Mentor not found.' });

    const now = new Date().toISOString();

    withTransaction(() => {
      if (display_name) {
        db.prepare('UPDATE mentors SET display_name = ? WHERE id = ?').run(display_name.trim(), mentorId);
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(display_name.trim(), mentor.user_id);
      }
      if (account_status && ['active', 'disabled'].includes(account_status)) {
        db.prepare('UPDATE mentors SET account_status = ? WHERE id = ?').run(account_status, mentorId);
        db.prepare('UPDATE users SET account_status = ? WHERE id = ?').run(account_status, mentor.user_id);
      }

      if (Array.isArray(class_ids)) {
        // Validate new class IDs
        for (const cId of class_ids) {
          const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND institute_id = ? AND is_active = 1').get(cId, adminInstituteId);
          if (!cls) throw new Error(`Class ID "${cId}" not found.`);
        }

        // Replace all class assignments atomically
        db.prepare('DELETE FROM mentor_class_assignments WHERE mentor_id = ? AND institute_id = ?').run(mentorId, adminInstituteId);
        const insertAsg = db.prepare(`
          INSERT OR IGNORE INTO mentor_class_assignments (id, institute_id, mentor_id, class_id, assigned_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        class_ids.forEach(cId => {
          insertAsg.run(uid('mca'), adminInstituteId, mentorId, cId, now);
        });
      }
    });

    return json(res, 200, { message: 'Mentor updated successfully.' });
  }

  return false; // not handled here
}

module.exports = { handleAdminPeopleRoutes };
