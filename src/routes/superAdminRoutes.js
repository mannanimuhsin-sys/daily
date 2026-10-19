const { db, withTransaction } = require('../db');

function handleSuperAdminRoutes(req, res, url, body) {
  if (!req.user || req.user.role !== 'super_admin') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: Super Administrator access required.' }));
    return true;
  }

  // 1. GET /api/super-admin/institutes
  if (req.method === 'GET' && url.pathname === '/api/super-admin/institutes') {
    const institutes = db.prepare(`
      SELECT i.*, u.display_name AS admin_name, u.mobile_number AS admin_mobile,
             COUNT(DISTINCT s.id) AS student_count,
             COUNT(DISTINCT c.id) AS class_count
      FROM institutes i
      LEFT JOIN users u ON i.id = u.institute_id AND u.role = 'institute_admin'
      LEFT JOIN students s ON i.id = s.institute_id
      LEFT JOIN classes c ON i.id = c.institute_id
      GROUP BY i.id
      ORDER BY i.created_at DESC
    `).all();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ institutes }));
  }

  // 2. POST /api/super-admin/institutes/approve
  if (req.method === 'POST' && url.pathname === '/api/super-admin/institutes/approve') {
    const { institute_id, approval_status } = body || {};
    if (!institute_id || !['approved', 'rejected', 'pending'].includes(approval_status)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'institute_id and valid approval_status are required.' }));
    }

    withTransaction(() => {
      db.prepare('UPDATE institutes SET approval_status = ? WHERE id = ?').run(approval_status, institute_id);

      // If approved, activate administrator user account
      const adminStatus = approval_status === 'approved' ? 'active' : 'pending';
      db.prepare("UPDATE users SET account_status = ? WHERE institute_id = ? AND role = 'institute_admin'").run(adminStatus, institute_id);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: `Institute ${approval_status} successfully.` }));
  }

  // 3. POST /api/super-admin/institutes/subscription
  if (req.method === 'POST' && url.pathname === '/api/super-admin/institutes/subscription') {
    const { institute_id, subscription_status } = body || {};
    const validStatuses = ['trial', 'active', 'past_due', 'expired'];
    if (!institute_id || !validStatuses.includes(subscription_status)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: `Valid subscription_status required: ${validStatuses.join(', ')}` }));
    }

    db.prepare('UPDATE institutes SET subscription_status = ? WHERE id = ?').run(subscription_status, institute_id);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: `Subscription updated to ${subscription_status}.` }));
  }

  // 4. GET /api/super-admin/payments
  if (req.method === 'GET' && url.pathname === '/api/super-admin/payments') {
    const payments = db.prepare(`
      SELECT p.*, i.name AS institute_name, u.display_name AS verified_by_name
      FROM subscription_payments p
      JOIN institutes i ON p.institute_id = i.id
      LEFT JOIN users u ON p.verified_by_user_id = u.id
      ORDER BY p.created_at DESC
    `).all();

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ payments }));
  }

  // 5. POST /api/super-admin/payments/verify
  if (req.method === 'POST' && url.pathname === '/api/super-admin/payments/verify') {
    const { payment_id, action } = body || {};
    if (!payment_id || !['verify', 'reject'].includes(action)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'payment_id and action (verify or reject) required.' }));
    }

    const payment = db.prepare('SELECT * FROM subscription_payments WHERE id = ?').get(payment_id);
    if (!payment) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Payment record not found.' }));
    }

    const now = new Date().toISOString();
    const newStatus = action === 'verify' ? 'verified' : 'rejected';

    withTransaction(() => {
      db.prepare(`
        UPDATE subscription_payments
        SET payment_status = ?, verified_by_user_id = ?, verified_at = ?
        WHERE id = ?
      `).run(newStatus, req.user.id, now, payment_id);

      if (action === 'verify') {
        db.prepare(`
          UPDATE institutes
          SET subscription_status = 'active', approval_status = 'approved'
          WHERE id = ?
        `).run(payment.institute_id);
      }
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: `Payment ${newStatus} and institute subscription updated.` }));
  }

  return false;
}

module.exports = { handleSuperAdminRoutes };
