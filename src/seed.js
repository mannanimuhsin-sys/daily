const crypto = require('node:crypto');
const { db, withTransaction } = require('./db');
const { hashPassword } = require('./auth');

function seed() {
  console.log('Seeding Islamic Daily Prayer Tracker database...');

  withTransaction(() => {
    // Clean old records for fresh seed
    db.exec(`
      DELETE FROM record_audit_logs;
      DELETE FROM daily_routine_records;
      DELETE FROM routine_class_assignments;
      DELETE FROM routines;
      DELETE FROM parent_student_links;
      DELETE FROM mentor_class_assignments;
      DELETE FROM mentors;
      DELETE FROM students;
      DELETE FROM classes;
      DELETE FROM subscription_payments;
      DELETE FROM institute_settings;
      DELETE FROM users;
      DELETE FROM institutes;
    `);

    const now = new Date().toISOString();
    const today = now.substring(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);

    // 1. Super Admin
    const superAdminId = 'usr_super_admin';
    const insertUser = db.prepare(`
      INSERT INTO users (id, authentication_user_id, display_name, mobile_number, password_hash, role, institute_id, account_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertUser.run(
      superAdminId,
      'auth_super_admin',
      'System Super Administrator',
      '9999900000',
      hashPassword('SuperAdmin@123'),
      'super_admin',
      null,
      'active',
      now
    );

    // 2. Institutes
    const insertInstitute = db.prepare(`
      INSERT INTO institutes (id, name, registration_number, administrator_user_id, approval_status, subscription_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const inst1Id = 'inst_alhuda_1';
    const inst2Id = 'inst_darul_2';
    const inst3Id = 'inst_alnoor_3';

    insertInstitute.run(inst1Id, 'Al-Huda Islamic Academy', 'REG/KL/2026/0422', 'usr_admin_alhuda', 'approved', 'active', now);
    insertInstitute.run(inst2Id, 'Darul Uloom Islamic Institute', 'REG/KL/2026/0891', 'usr_admin_darul', 'approved', 'active', now);
    insertInstitute.run(inst3Id, 'Al-Noor Madrasa (New Registration)', 'REG/KL/2026/1105', 'usr_admin_alnoor', 'pending', 'trial', now);

    // 3. Institute Settings
    const insertSettings = db.prepare(`
      INSERT INTO institute_settings (institute_id, parent_recording_enabled, student_read_only_enabled, record_edit_deadline, allowed_backdate_days, administrator_approval_for_corrections, timezone, excused_status_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSettings.run(inst1Id, 1, 1, '23:59', 7, 0, 'Asia/Kolkata', 1);
    insertSettings.run(inst2Id, 1, 1, '23:00', 5, 1, 'Asia/Kolkata', 1);
    insertSettings.run(inst3Id, 1, 0, '22:00', 3, 0, 'Asia/Kolkata', 1);

    // 4. Institute Admins
    insertUser.run(
      'usr_admin_alhuda',
      'auth_admin_alhuda',
      'Usthad Ahmad (Principal)',
      '9847111222',
      hashPassword('Admin@123'),
      'institute_admin',
      inst1Id,
      'active',
      now
    );

    insertUser.run(
      'usr_admin_darul',
      'auth_admin_darul',
      'Usthad Ibrahim (Darul Uloom)',
      '9847555666',
      hashPassword('Admin@123'),
      'institute_admin',
      inst2Id,
      'active',
      now
    );

    insertUser.run(
      'usr_admin_alnoor',
      'auth_admin_alnoor',
      'Usthad Mansoor (Applicant)',
      '9847999888',
      hashPassword('Admin@123'),
      'institute_admin',
      inst3Id,
      'pending',
      now
    );

    // 5. Classes for Institute 1
    const insertClass = db.prepare(`
      INSERT INTO classes (id, institute_id, class_number, class_name, division, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const cls4A = 'cls_alhuda_4a';
    const cls7B = 'cls_alhuda_7b';
    const cls10A = 'cls_alhuda_10a';

    insertClass.run(cls4A, inst1Id, 4, 'Class 4', 'A', 1);
    insertClass.run(cls7B, inst1Id, 7, 'Class 7', 'B', 1);
    insertClass.run(cls10A, inst1Id, 10, 'Class 10', 'A', 1);

    // Class for Institute 2
    const clsDarul5 = 'cls_darul_5a';
    insertClass.run(clsDarul5, inst2Id, 5, 'Class 5', 'A', 1);

    // 6. Students for Institute 1
    const insertStudent = db.prepare(`
      INSERT INTO students (id, institute_id, class_id, student_name, admission_number, account_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const stuBilal = 'stu_bilal_4a';
    const stuZahra = 'stu_zahra_7b';
    const stuAmeen = 'stu_ameen_4a';

    insertStudent.run(stuBilal, inst1Id, cls4A, 'Muhammed Bilal', 'AH-2026-041', 'active', now);
    insertStudent.run(stuZahra, inst1Id, cls7B, 'Fathima Zahra', 'AH-2026-072', 'active', now);
    insertStudent.run(stuAmeen, inst1Id, cls4A, 'Ameen K', 'AH-2026-049', 'active', now);

    // Student for Institute 2
    const stuDarul = 'stu_salman_darul';
    insertStudent.run(stuDarul, inst2Id, clsDarul5, 'Salman Faris', 'DU-2026-015', 'active', now);

    // 7. Parents
    const parentAbdulId = 'usr_parent_abdul';
    insertUser.run(
      parentAbdulId,
      'auth_parent_abdul',
      'Abdul Rahman (Parent)',
      '9447333444',
      hashPassword('Parent@123'),
      'parent',
      inst1Id,
      'active',
      now
    );

    const parentZubairId = 'usr_parent_zubair';
    insertUser.run(
      parentZubairId,
      'auth_parent_zubair',
      'Zubair K (Ameen\'s Parent)',
      '9447888777',
      hashPassword('Parent@123'),
      'parent',
      inst1Id,
      'active',
      now
    );

    // 8. Link Parent to Multiple Children
    const insertLink = db.prepare(`
      INSERT INTO parent_student_links (id, institute_id, parent_user_id, student_id, is_active, authorized_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertLink.run('link_abdul_bilal', inst1Id, parentAbdulId, stuBilal, 1, 'usr_admin_alhuda', now);
    insertLink.run('link_abdul_zahra', inst1Id, parentAbdulId, stuZahra, 1, 'usr_admin_alhuda', now);
    insertLink.run('link_zubair_ameen', inst1Id, parentZubairId, stuAmeen, 1, 'usr_admin_alhuda', now);

    // 9. Student Read-Only Account (Optional login)
    insertUser.run(
      'usr_student_bilal',
      'auth_student_bilal',
      'Muhammed Bilal (Student Account)',
      '9000111222',
      hashPassword('Student@123'),
      'student',
      inst1Id,
      'active',
      now
    );

    // 10. Routines for Institute 1
    const insertRoutine = db.prepare(`
      INSERT INTO routines (id, institute_id, routine_name_ml, routine_name_en, category, is_prayer, is_active, display_order, effective_start_date, effective_end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const prayers = [
      { id: 'rt_fajr_1', ml: 'സുബ്ഹ്', en: 'Fajr', order: 1 },
      { id: 'rt_dhuhr_1', ml: 'ളുഹർ', en: 'Dhuhr', order: 2 },
      { id: 'rt_asr_1', ml: 'അസർ', en: 'Asr', order: 3 },
      { id: 'rt_maghrib_1', ml: 'മഗ്രിബ്', en: 'Maghrib', order: 4 },
      { id: 'rt_isha_1', ml: 'ഇശാ', en: 'Isha', order: 5 }
    ];

    const insertAssignment = db.prepare(`
      INSERT INTO routine_class_assignments (id, institute_id, routine_id, class_id, applies_to_all_classes)
      VALUES (?, ?, ?, ?, ?)
    `);

    prayers.forEach(p => {
      insertRoutine.run(p.id, inst1Id, p.ml, p.en, 'prayer', 1, 1, p.order, null, null);
      insertAssignment.run(`asg_${p.id}_all`, inst1Id, p.id, null, 1);
    });

    // Custom routines for Institute 1
    // A: Quran Recitation (all classes)
    const rtQuran = 'rt_quran_1';
    insertRoutine.run(rtQuran, inst1Id, 'ഖുർആൻ പാരായണം', "Qur'an Recitation", 'quran', 0, 1, 6, null, null);
    insertAssignment.run(`asg_${rtQuran}_all`, inst1Id, rtQuran, null, 1);

    // B: Morning & Evening Adhkar (all classes)
    const rtAdhkar = 'rt_adhkar_1';
    insertRoutine.run(rtAdhkar, inst1Id, 'ദിക്റുകൾ & ദുആകൾ', 'Morning & Evening Adhkar', 'adhkar', 0, 1, 7, null, null);
    insertAssignment.run(`asg_${rtAdhkar}_all`, inst1Id, rtAdhkar, null, 1);

    // C: Hifz Revision (ONLY for Class 7-B)
    const rtHifz = 'rt_hifz_1';
    insertRoutine.run(rtHifz, inst1Id, 'ഹിഫ്ള് ആവർത്തനം', 'Hifz Revision', 'quran', 0, 1, 8, null, null);
    insertAssignment.run(`asg_${rtHifz}_cls7`, inst1Id, rtHifz, cls7B, 0);

    // 11. Initial Daily Records & Audit Logs for Yesterday
    const insertRecord = db.prepare(`
      INSERT INTO daily_routine_records (id, institute_id, student_id, routine_id, activity_date, status, recorded_by_user_id, recorded_by_role, created_at, updated_at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAudit = db.prepare(`
      INSERT INTO record_audit_logs (id, institute_id, record_id, actor_user_id, actor_role, previous_status, new_status, reason, action_timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Bilal yesterday records by parent
    const rec1Id = 'rec_bilal_fajr_yesterday';
    insertRecord.run(rec1Id, inst1Id, stuBilal, 'rt_fajr_1', yesterday, 'completed', parentAbdulId, 'parent', yesterday + 'T06:30:00Z', yesterday + 'T06:30:00Z', 1);
    insertAudit.run('aud_1', inst1Id, rec1Id, parentAbdulId, 'parent', 'not_recorded', 'completed', 'Parent initial recording', yesterday + 'T06:30:00Z');

    const rec2Id = 'rec_bilal_dhuhr_yesterday';
    insertRecord.run(rec2Id, inst1Id, stuBilal, 'rt_dhuhr_1', yesterday, 'completed', parentAbdulId, 'parent', yesterday + 'T13:45:00Z', yesterday + 'T13:45:00Z', 1);
    insertAudit.run('aud_2', inst1Id, rec2Id, parentAbdulId, 'parent', 'not_recorded', 'completed', 'Parent initial recording', yesterday + 'T13:45:00Z');

    // Bilal Asr was missed according to parent, but Usthad corrected it because Bilal prayed in madrasa jama'ath
    const rec3Id = 'rec_bilal_asr_yesterday';
    insertRecord.run(rec3Id, inst1Id, stuBilal, 'rt_asr_1', yesterday, 'completed', 'usr_admin_alhuda', 'institute_admin', yesterday + 'T17:00:00Z', yesterday + 'T18:00:00Z', 2);
    insertAudit.run('aud_3a', inst1Id, rec3Id, parentAbdulId, 'parent', 'not_recorded', 'not_completed', 'Parent initial recording', yesterday + 'T17:00:00Z');
    insertAudit.run('aud_3b', inst1Id, rec3Id, 'usr_admin_alhuda', 'institute_admin', 'not_completed', 'completed', 'Student participated in Madrasa Asr congregation', yesterday + 'T18:00:00Z');

    // 12. Payment record for Institute 1
    const insertPayment = db.prepare(`
      INSERT INTO subscription_payments (id, institute_id, plan_name, amount, payment_reference, payment_proof_note, payment_status, verified_by_user_id, verified_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertPayment.run('pay_alhuda_annual', inst1Id, 'Annual Premium Plan', 4999.00, 'UPI/2026/8849204', 'Bank transfer via GPay, Transaction #TXN992384', 'verified', superAdminId, now, now);

    console.log('Database seeded successfully with realistic data!');
  });
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
