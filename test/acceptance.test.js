const assert = require('node:assert');
const http = require('node:http');
const { server } = require('../server');
const { seed } = require('../src/seed');
const { db } = require('../src/db');

const TEST_PORT = 3099;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (e) {
          json = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runAcceptanceTests() {
  console.log('================================================================');
  console.log('🚀 RUNNING 12 MANDATORY ACCEPTANCE TESTS');
  console.log('================================================================');

  // Reset and seed database
  seed();

  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`Test server running on port ${TEST_PORT}\n`);

  let passed = 0;
  let failed = 0;

  async function test(title, fn) {
    try {
      await fn();
      console.log(`✅ TEST PASSED: ${title}`);
      passed++;
    } catch (err) {
      console.error(`❌ TEST FAILED: ${title}`);
      console.error(err);
      failed++;
    }
  }

  // Tokens for actors
  let parentToken = null;
  let adminToken = null;
  let studentToken = null;
  let otherAdminToken = null;

  const today = new Date().toISOString().substring(0, 10);
  const stuBilal = 'stu_bilal_4a';
  const stuZahra = 'stu_zahra_7b';
  const stuAmeen = 'stu_ameen_4a'; // Belongs to different parent (Zubair)
  const stuDarul = 'stu_salman_darul'; // Belongs to Institute 2

  // Login tokens
  const loginParent = await request('POST', '/api/auth/login', { mobile_number: '9447333444', password: 'Parent@123' });
  parentToken = loginParent.data.token;

  const loginAdmin = await request('POST', '/api/auth/login', { mobile_number: '9847111222', password: 'Admin@123' });
  adminToken = loginAdmin.data.token;

  const loginStudent = await request('POST', '/api/auth/login', { mobile_number: '9000111222', password: 'Student@123' });
  studentToken = loginStudent.data.token;

  const loginDarulAdmin = await request('POST', '/api/auth/login', { mobile_number: '9847555666', password: 'Admin@123' });
  otherAdminToken = loginDarulAdmin.data.token;

  // 1. A parent can record all five daily prayers for an authorized child.
  await test('1. Parent can record all five daily prayers for an authorized child', async () => {
    const prayers = ['rt_fajr_1', 'rt_dhuhr_1', 'rt_asr_1', 'rt_maghrib_1', 'rt_isha_1'];

    for (const pId of prayers) {
      const res = await request('POST', '/api/parent/record', {
        student_id: stuBilal,
        routine_id: pId,
        activity_date: today,
        status: 'completed'
      }, parentToken);

      assert.strictEqual(res.status, 200, `Failed to record prayer ${pId}: ${JSON.stringify(res.data)}`);
      assert.strictEqual(res.data.record.status, 'completed');
      assert.strictEqual(res.data.record.recorded_by_role, 'parent');
    }

    // Verify in child data
    const childRes = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, parentToken);
    assert.strictEqual(childRes.status, 200);
    assert.strictEqual(childRes.data.progress.prayers.completed, 5);
    assert.strictEqual(childRes.data.progress.prayers.not_recorded, 0);
  });

  // 2. The records remain saved after logout and login.
  await test('2. Records remain saved after logout and login', async () => {
    // Re-login to get fresh token simulating session persistence
    const reLogin = await request('POST', '/api/auth/login', { mobile_number: '9447333444', password: 'Parent@123' });
    assert.strictEqual(reLogin.status, 200);
    const newToken = reLogin.data.token;

    const childRes = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, newToken);
    assert.strictEqual(childRes.status, 200);
    assert.strictEqual(childRes.data.progress.prayers.completed, 5);
    const fajr = childRes.data.prayers.find(p => p.routine_id === 'rt_fajr_1');
    assert.strictEqual(fajr.status, 'completed');
  });

  // 3. A parent with multiple children can switch between children.
  await test('3. Parent with multiple children can switch between children', async () => {
    const childrenRes = await request('GET', '/api/parent/children', null, parentToken);
    assert.strictEqual(childrenRes.status, 200);
    assert.strictEqual(childrenRes.data.children.length, 2, 'Parent should have exactly 2 linked children');

    const childIds = childrenRes.data.children.map(c => c.id);
    assert.ok(childIds.includes(stuBilal), 'Should include Bilal');
    assert.ok(childIds.includes(stuZahra), 'Should include Zahra');

    // Fetch Bilal
    const bilalData = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, parentToken);
    assert.strictEqual(bilalData.data.student.student_name, 'Muhammed Bilal');

    // Switch to Zahra
    const zahraData = await request('GET', `/api/parent/child-data?student_id=${stuZahra}&date=${today}`, null, parentToken);
    assert.strictEqual(zahraData.data.student.student_name, 'Fathima Zahra');
  });

  // 4. One child's records never appear under another child's profile.
  await test("4. One child's records never appear under another child's profile", async () => {
    // Bilal has 5 completed prayers.
    // Zahra has not recorded today yet.
    const zahraData = await request('GET', `/api/parent/child-data?student_id=${stuZahra}&date=${today}`, null, parentToken);
    assert.strictEqual(zahraData.data.progress.prayers.completed, 0, 'Zahra must not inherit Bilal completed prayers');
    assert.strictEqual(zahraData.data.progress.prayers.not_recorded, 5, 'All Zahra prayers must be unrecorded');

    // Record 1 prayer for Zahra as excused
    await request('POST', '/api/parent/record', {
      student_id: stuZahra,
      routine_id: 'rt_fajr_1',
      activity_date: today,
      status: 'excused'
    }, parentToken);

    // Verify Bilal is still completed and Zahra is excused
    const bilalCheck = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, parentToken);
    const zahraCheck = await request('GET', `/api/parent/child-data?student_id=${stuZahra}&date=${today}`, null, parentToken);

    const bilalFajr = bilalCheck.data.prayers.find(p => p.routine_id === 'rt_fajr_1');
    const zahraFajr = zahraCheck.data.prayers.find(p => p.routine_id === 'rt_fajr_1');

    assert.strictEqual(bilalFajr.status, 'completed');
    assert.strictEqual(zahraFajr.status, 'excused');
  });

  // 5. A student account cannot change any record through the interface or direct backend requests.
  await test('5. Student account cannot change any record (backend enforced read-only)', async () => {
    // Attempt POST to parent record
    const postRes = await request('POST', '/api/parent/record', {
      student_id: stuBilal,
      routine_id: 'rt_fajr_1',
      activity_date: today,
      status: 'not_completed'
    }, studentToken);
    assert.strictEqual(postRes.status, 403, 'Student POST must return 403 Forbidden');

    // Attempt direct correction
    const correctRes = await request('POST', '/api/admin/correct-record', {
      student_id: stuBilal,
      routine_id: 'rt_fajr_1',
      activity_date: today,
      new_status: 'not_completed',
      reason: 'Hacked'
    }, studentToken);
    assert.strictEqual(correctRes.status, 403, 'Student correction must return 403 Forbidden');

    // Attempt student progress read - should succeed as read-only
    const readRes = await request('GET', `/api/student/my-progress?date=${today}`, null, studentToken);
    assert.strictEqual(readRes.status, 200, 'Student should be allowed to view own progress in read-only mode');
    assert.strictEqual(readRes.data.read_only, true);
  });

  // 6. A parent cannot submit records for an unauthorized student.
  await test('6. Parent cannot submit records for an unauthorized student', async () => {
    // Parent Abdul attempts to write for Ameen (linked to Zubair)
    const unauthorizedRes = await request('POST', '/api/parent/record', {
      student_id: stuAmeen,
      routine_id: 'rt_fajr_1',
      activity_date: today,
      status: 'completed'
    }, parentToken);

    assert.strictEqual(unauthorizedRes.status, 403, 'Unauthorized student recording must be rejected with 403 Forbidden');

    // Parent Abdul attempts to view Ameen's data
    const viewRes = await request('GET', `/api/parent/child-data?student_id=${stuAmeen}&date=${today}`, null, parentToken);
    assert.strictEqual(viewRes.status, 403, 'Viewing unauthorized student data must be rejected with 403');
  });

  // 7. The institute administrator can review and correct records within the permitted policy.
  await test('7. Institute administrator can review and correct records within permitted policy', async () => {
    // Admin reviews records
    const recordsRes = await request('GET', `/api/admin/records?student_id=${stuBilal}&date=${today}`, null, adminToken);
    assert.strictEqual(recordsRes.status, 200);
    assert.ok(recordsRes.data.records.length > 0);

    // Admin corrects Maghrib prayer with reason
    const correctRes = await request('POST', '/api/admin/correct-record', {
      student_id: stuBilal,
      routine_id: 'rt_maghrib_1',
      activity_date: today,
      new_status: 'completed',
      reason: 'Verified by Usthad: Prayed Maghrib with jamaath at Madrasa mosque'
    }, adminToken);

    assert.strictEqual(correctRes.status, 200, `Correction failed: ${JSON.stringify(correctRes.data)}`);
    assert.strictEqual(correctRes.data.data.new_status, 'completed');

    // Verify attribution in child data
    const bilalUpdated = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, parentToken);
    const maghrib = bilalUpdated.data.prayers.find(p => p.routine_id === 'rt_maghrib_1');
    assert.strictEqual(maghrib.recorded_by_role, 'institute_admin', 'Attribution must be institute_admin');
    assert.strictEqual(maghrib.is_admin_corrected, true);
  });

  // 8. Every correction records the actor, timestamp, and previous status.
  await test('8. Every correction records actor, timestamp, and previous status in audit log', async () => {
    const auditRes = await request('GET', `/api/admin/audit-logs?student_id=${stuBilal}`, null, adminToken);
    assert.strictEqual(auditRes.status, 200);
    assert.ok(auditRes.data.audit_logs.length > 0, 'Audit logs must exist');

    const latest = auditRes.data.audit_logs[0];
    assert.ok(latest.actor_user_id, 'Actor user ID must be present');
    assert.strictEqual(latest.actor_role, 'institute_admin');
    assert.ok(latest.action_timestamp, 'Action timestamp must be recorded');
    assert.ok(latest.reason && latest.reason.includes('Madrasa mosque'), 'Mandatory correction reason must be saved');
    assert.ok(latest.previous_status, 'Previous status must be tracked');
  });

  // 9. Class-specific routines appear only for the correct classes.
  await test('9. Class-specific routines appear only for the correct classes', async () => {
    // Bilal is Class 4-A.
    // Zahra is Class 7-B.
    // Routine rt_hifz_1 ('ഹിഫ്ള് ആവർത്തനം') is assigned ONLY to Class 7-B.

    const bilalData = await request('GET', `/api/parent/child-data?student_id=${stuBilal}&date=${today}`, null, parentToken);
    const zahraData = await request('GET', `/api/parent/child-data?student_id=${stuZahra}&date=${today}`, null, parentToken);

    const bilalHasHifz = bilalData.data.custom_routines.some(r => r.routine_id === 'rt_hifz_1');
    const zahraHasHifz = zahraData.data.custom_routines.some(r => r.routine_id === 'rt_hifz_1');

    assert.strictEqual(bilalHasHifz, false, 'Class 4-A student must NOT see Class 7-B Hifz routine');
    assert.strictEqual(zahraHasHifz, true, 'Class 7-B student MUST see Hifz routine');
  });

  // 10. An unrecorded prayer is not automatically classified as missed.
  await test('10. An unrecorded prayer is not automatically classified as missed', async () => {
    // For Ameen K, nothing recorded today
    const zubairLogin = await request('POST', '/api/auth/login', { mobile_number: '9447888777', password: 'Parent@123' });
    const zubairToken = zubairLogin.data.token;

    const ameenData = await request('GET', `/api/parent/child-data?student_id=${stuAmeen}&date=${today}`, null, zubairToken);
    assert.strictEqual(ameenData.data.progress.prayers.not_recorded, 5, 'All 5 prayers must be not_recorded');
    assert.strictEqual(ameenData.data.progress.prayers.not_completed, 0, 'Unrecorded must NOT be counted as not_completed');

    ameenData.data.prayers.forEach(p => {
      assert.strictEqual(p.status, 'not_recorded', `${p.routine_name_en} must be 'not_recorded'`);
    });
  });

  // 11. Date restrictions and submission deadlines are enforced on the backend.
  await test('11. Date restrictions and submission deadlines are enforced on backend', async () => {
    // Future date attempt
    const tomorrow = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
    const futureRes = await request('POST', '/api/parent/record', {
      student_id: stuBilal,
      routine_id: 'rt_fajr_1',
      activity_date: tomorrow,
      status: 'completed'
    }, parentToken);

    assert.strictEqual(futureRes.status, 403, 'Future date must be rejected with 403');
    assert.ok(futureRes.data.error.includes('Future dates'), 'Should explain future date rejection');

    // Date older than allowed_backdate_days (e.g. 30 days ago, limit is 7)
    const oldDate = '2026-08-01';
    const oldRes = await request('POST', '/api/parent/record', {
      student_id: stuBilal,
      routine_id: 'rt_fajr_1',
      activity_date: oldDate,
      status: 'completed'
    }, parentToken);

    assert.strictEqual(oldRes.status, 403, 'Old date exceeding backdate days must be rejected with 403');
    assert.ok(oldRes.data.error.includes('allowed backdate'), 'Should explain backdate limit');
  });

  // 12. All institute-level access rules are enforced by the database or secure backend.
  await test('12. Institute-level access rules are strictly isolated on backend', async () => {
    // Admin from Institute 2 (Darul Uloom) tries to access records of Institute 1 (Al-Huda)
    const crossRecords = await request('GET', `/api/admin/records?student_id=${stuBilal}`, null, otherAdminToken);
    assert.strictEqual(crossRecords.status, 200);
    assert.strictEqual(crossRecords.data.records.length, 0, 'Admin 2 cannot see Institute 1 records');

    // Admin 2 tries to correct Institute 1 student record
    const crossCorrect = await request('POST', '/api/admin/correct-record', {
      student_id: stuBilal,
      routine_id: 'rt_fajr_1',
      activity_date: today,
      new_status: 'completed',
      reason: 'Malicious cross-institute attempt'
    }, otherAdminToken);

    assert.strictEqual(crossCorrect.status, 403, 'Cross-institute correction must be rejected with 403 Forbidden');
    assert.ok(crossCorrect.data.error.includes('does not belong to your institute'));
  });

  console.log('\n================================================================');
  console.log(`ACCEPTANCE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  server.close();
  process.exit(failed === 0 ? 0 : 1);
}

runAcceptanceTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
