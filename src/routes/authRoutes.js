const { db } = require('../db');
const { hashPassword, verifyPassword, createToken } = require('../auth');

function handleAuthRoutes(req, res, url, body) {
  // POST /api/auth/login
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const { mobile_number, password } = body || {};
    if (!mobile_number || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Mobile number and password are required.' }));
    }

    const user = db.prepare('SELECT * FROM users WHERE mobile_number = ?').get(mobile_number.trim());
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid mobile number or password.' }));
    }

    if (user.account_status !== 'active') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Account is ${user.account_status}. Please contact administrator.` }));
    }

    if (!verifyPassword(password, user.password_hash)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid mobile number or password.' }));
    }

    let institute = null;
    if (user.institute_id) {
      institute = db.prepare('SELECT * FROM institutes WHERE id = ?').get(user.institute_id);
      if (user.role !== 'super_admin') {
        if (!institute) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Associated institute not found.' }));
        }
        if (institute.approval_status !== 'approved') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            error: `Institute is currently ${institute.approval_status}. Pending super administrator approval.`
          }));
        }
      }
    }

    const token = createToken({
      id: user.id,
      role: user.role,
      mobile_number: user.mobile_number,
      display_name: user.display_name,
      institute_id: user.institute_id
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        display_name: user.display_name,
        mobile_number: user.mobile_number,
        role: user.role,
        institute_id: user.institute_id,
        institute_name: institute ? institute.name : null
      }
    }));
  }

  // GET /api/auth/me
  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    if (!req.user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    let institute = null;
    if (req.user.institute_id) {
      institute = db.prepare('SELECT * FROM institutes WHERE id = ?').get(req.user.institute_id);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      user: {
        id: req.user.id,
        display_name: req.user.display_name,
        mobile_number: req.user.mobile_number,
        role: req.user.role,
        institute_id: req.user.institute_id,
        institute_name: institute ? institute.name : null,
        subscription_status: institute ? institute.subscription_status : null
      }
    }));
  }

  // POST /api/auth/register-institute
  if (req.method === 'POST' && url.pathname === '/api/auth/register-institute') {
    const { institute_name, registration_number, admin_name, mobile_number, password } = body || {};
    if (!institute_name || !admin_name || !mobile_number || !password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'All fields are required.' }));
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE mobile_number = ?').get(mobile_number.trim());
    if (existingUser) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'A user with this mobile number already exists.' }));
    }

    const instituteId = 'inst_' + Date.now();
    const adminId = 'usr_admin_' + Date.now();
    const now = new Date().toISOString();

    const { withTransaction } = require('../db');
    withTransaction(() => {
      // 1. Insert Institute (pending approval)
      db.prepare(`
        INSERT INTO institutes (id, name, registration_number, administrator_user_id, approval_status, subscription_status, created_at)
        VALUES (?, ?, ?, ?, 'pending', 'trial', ?)
      `).run(instituteId, institute_name.trim(), registration_number ? registration_number.trim() : null, adminId, now);

      // 2. Insert Admin User (pending)
      db.prepare(`
        INSERT INTO users (id, authentication_user_id, display_name, mobile_number, password_hash, role, institute_id, account_status, created_at)
        VALUES (?, ?, ?, ?, ?, 'institute_admin', ?, 'pending', ?)
      `).run(adminId, 'auth_' + adminId, admin_name.trim(), mobile_number.trim(), hashPassword(password), instituteId, now);

      // 3. Default Settings
      db.prepare(`
        INSERT INTO institute_settings (institute_id, parent_recording_enabled, student_read_only_enabled, record_edit_deadline, allowed_backdate_days, administrator_approval_for_corrections, timezone, excused_status_enabled)
        VALUES (?, 1, 1, '23:59', 7, 0, 'Asia/Kolkata', 1)
      `).run(instituteId);

      // 4. Default 5 Daily Prayers
      const prayers = [
        { id: `rt_${Date.now()}_fajr`, ml: 'സുബ്ഹ്', en: 'Fajr', order: 1 },
        { id: `rt_${Date.now()}_dhuhr`, ml: 'ളുഹർ', en: 'Dhuhr', order: 2 },
        { id: `rt_${Date.now()}_asr`, ml: 'അസർ', en: 'Asr', order: 3 },
        { id: `rt_${Date.now()}_maghrib`, ml: 'മഗ്രിബ്', en: 'Maghrib', order: 4 },
        { id: `rt_${Date.now()}_isha`, ml: 'ഇശാ', en: 'Isha', order: 5 }
      ];

      const insertRoutine = db.prepare(`
        INSERT INTO routines (id, institute_id, routine_name_ml, routine_name_en, category, is_prayer, is_active, display_order)
        VALUES (?, ?, ?, ?, 'prayer', 1, 1, ?)
      `);
      const insertAsg = db.prepare(`
        INSERT INTO routine_class_assignments (id, institute_id, routine_id, class_id, applies_to_all_classes)
        VALUES (?, ?, ?, null, 1)
      `);

      prayers.forEach(p => {
        insertRoutine.run(p.id, instituteId, p.ml, p.en, p.order);
        insertAsg.run('asg_' + p.id, instituteId, p.id);
      });
    });

    res.writeHead(201, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      message: 'Institute registration submitted successfully! Awaiting Super Administrator approval.',
      institute_id: instituteId
    }));
  }

  return false;
}

module.exports = { handleAuthRoutes };
