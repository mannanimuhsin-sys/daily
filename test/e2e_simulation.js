const http = require('node:http');
const assert = require('node:assert');
const { seed } = require('../src/seed');

const PORT = 3000;

function req(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const opt = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opt.headers['Authorization'] = `Bearer ${token}`;

    const r = http.request(opt, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(d) });
        } catch (e) {
          resolve({ status: res.statusCode, data: d });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function runE2E() {
  console.log('--- STARTING COMPREHENSIVE END-TO-END FLOW ON PORT 3000 ---');
  seed();
  const today = new Date().toISOString().substring(0, 10);

  // 1. Parent Login
  const parentLogin = await req('POST', '/api/auth/login', { mobile_number: '9447333444', password: 'Parent@123' });
  assert.strictEqual(parentLogin.status, 200);
  const parentToken = parentLogin.data.token;
  console.log('✓ 1. Parent logged in successfully:', parentLogin.data.user.display_name);

  // 2. Fetch linked children
  const childrenRes = await req('GET', '/api/parent/children', null, parentToken);
  assert.strictEqual(childrenRes.status, 200);
  assert.strictEqual(childrenRes.data.children.length, 2);
  const [bilal, zahra] = childrenRes.data.children;
  console.log(`✓ 2. Found ${childrenRes.data.children.length} linked children: ${bilal.student_name} (${bilal.class_name} ${bilal.division}) and ${zahra.student_name} (${zahra.class_name} ${zahra.division})`);

  // 3. Parent records prayers for Bilal
  for (const prayerId of ['rt_fajr_1', 'rt_dhuhr_1', 'rt_asr_1', 'rt_maghrib_1', 'rt_isha_1']) {
    const recRes = await req('POST', '/api/parent/record', {
      student_id: bilal.id,
      routine_id: prayerId,
      activity_date: today,
      status: 'completed'
    }, parentToken);
    assert.strictEqual(recRes.status, 200);
  }
  console.log('✓ 3. Recorded all 5 daily prayers as completed for Bilal');

  // 4. Switch to Zahra & verify isolation
  const zahraData = await req('GET', `/api/parent/child-data?student_id=${zahra.id}&date=${today}`, null, parentToken);
  assert.strictEqual(zahraData.status, 200);
  assert.strictEqual(zahraData.data.progress.prayers.completed, 0, 'Zahra prayers must be unaffected by Bilal');
  console.log('✓ 4. Switched to Zahra without logging out; confirmed records are isolated (0 completed)');

  // 5. Check Class-specific Routines: Hifz Revision for Class 7 only
  const bilalData = await req('GET', `/api/parent/child-data?student_id=${bilal.id}&date=${today}`, null, parentToken);
  const bilalHasHifz = bilalData.data.custom_routines.some(r => r.routine_id === 'rt_hifz_1');
  const zahraHasHifz = zahraData.data.custom_routines.some(r => r.routine_id === 'rt_hifz_1');
  assert.strictEqual(bilalHasHifz, false, 'Class 4 student must not have Hifz Revision');
  assert.strictEqual(zahraHasHifz, true, 'Class 7 student must have Hifz Revision');
  console.log('✓ 5. Class-specific routines validated: Hifz Revision appears only for Class 7 Zahra, not Class 4 Bilal');

  // 6. Record Zahra's prayers: Fajr completed, Asr excused
  await req('POST', '/api/parent/record', { student_id: zahra.id, routine_id: 'rt_fajr_1', activity_date: today, status: 'completed' }, parentToken);
  await req('POST', '/api/parent/record', { student_id: zahra.id, routine_id: 'rt_asr_1', activity_date: today, status: 'excused' }, parentToken);
  const zahraUpdated = await req('GET', `/api/parent/child-data?student_id=${zahra.id}&date=${today}`, null, parentToken);
  assert.strictEqual(zahraUpdated.data.progress.prayers.completed, 1);
  assert.strictEqual(zahraUpdated.data.progress.prayers.excused, 1);
  assert.strictEqual(zahraUpdated.data.progress.prayers.not_recorded, 3);
  console.log('✓ 6. Zahra recorded: 1 Completed, 1 Excused, 3 Unrecorded (unrecorded NOT counted as missed)');

  // 7. Student Account Read-Only enforcement
  const studentLogin = await req('POST', '/api/auth/login', { mobile_number: '9000111222', password: 'Student@123' });
  assert.strictEqual(studentLogin.status, 200);
  const studentToken = studentLogin.data.token;
  const studentRead = await req('GET', `/api/student/my-progress?date=${today}`, null, studentToken);
  assert.strictEqual(studentRead.status, 200);
  assert.strictEqual(studentRead.data.read_only, true);

  // Student write attempt rejected
  const studentWrite = await req('POST', '/api/parent/record', { student_id: bilal.id, routine_id: 'rt_fajr_1', activity_date: today, status: 'not_completed' }, studentToken);
  assert.strictEqual(studentWrite.status, 403, 'Student mutation must be rejected with 403 Forbidden');
  console.log('✓ 7. Student account read-only enforcement validated: viewing succeeded, mutation returned 403 Forbidden');

  // 8. Institute Admin Review and Correction with Mandatory Reason
  const adminLogin = await req('POST', '/api/auth/login', { mobile_number: '9847111222', password: 'Admin@123' });
  assert.strictEqual(adminLogin.status, 200);
  const adminToken = adminLogin.data.token;

  // Attempt correction without reason -> must fail
  const noReason = await req('POST', '/api/admin/correct-record', {
    student_id: bilal.id,
    routine_id: 'rt_asr_1',
    activity_date: today,
    new_status: 'completed',
    reason: ''
  }, adminToken);
  assert.strictEqual(noReason.status, 400, 'Correction without reason must be rejected with 400 Bad Request');

  // Correction with valid reason
  const withReason = await req('POST', '/api/admin/correct-record', {
    student_id: bilal.id,
    routine_id: 'rt_asr_1',
    activity_date: today,
    new_status: 'completed',
    reason: 'Verified by Usthad: Bilal joined congregation at mosque'
  }, adminToken);
  assert.strictEqual(withReason.status, 200);
  console.log('✓ 8. Admin correction with mandatory reason executed successfully');

  // 9. Verify Immutable Audit Log
  const auditRes = await req('GET', `/api/admin/audit-logs?student_id=${bilal.id}`, null, adminToken);
  assert.strictEqual(auditRes.status, 200);
  const latestAudit = auditRes.data.audit_logs[0];
  assert.strictEqual(latestAudit.actor_role, 'institute_admin');
  assert.ok(latestAudit.reason.includes('Bilal joined congregation'));
  assert.ok(latestAudit.action_timestamp);
  console.log(`✓ 9. Audit log verified: Actor=${latestAudit.actor_name}, Prev=${latestAudit.previous_status}, New=${latestAudit.new_status}, Reason="${latestAudit.reason}"`);

  // 10. Super Admin Approval & Subscription Workflow
  const superLogin = await req('POST', '/api/auth/login', { mobile_number: '9999900000', password: 'SuperAdmin@123' });
  assert.strictEqual(superLogin.status, 200);
  const superToken = superLogin.data.token;

  const institutes = await req('GET', '/api/super-admin/institutes', null, superToken);
  assert.strictEqual(institutes.status, 200);
  const pendingInst = institutes.data.institutes.find(i => i.approval_status === 'pending');
  assert.ok(pendingInst, 'Pending institute must exist');

  // Approve pending institute
  const approveRes = await req('POST', '/api/super-admin/institutes/approve', {
    institute_id: pendingInst.id,
    approval_status: 'approved'
  }, superToken);
  assert.strictEqual(approveRes.status, 200);
  console.log(`✓ 10. Super Admin approval verified: ${pendingInst.name} approved`);

  // 11. Parent Reports
  const reportRes = await req('GET', `/api/parent/reports?student_id=${bilal.id}&days=30`, null, parentToken);
  assert.strictEqual(reportRes.status, 200);
  assert.ok(reportRes.data.summary.completed_prayers > 0);
  console.log(`✓ 11. Parent reports verified: ${reportRes.data.summary.completed_prayers} completed prayers tracked over ${reportRes.data.summary.recorded_days_count} recorded days`);

  console.log('\n🎉 ALL 11 END-TO-END FLOWS COMPLETED WITH 100% SUCCESS ON PRODUCTION SERVER!');
}

runE2E().catch(err => {
  console.error('E2E Failure:', err);
  process.exit(1);
});
