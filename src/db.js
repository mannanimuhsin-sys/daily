const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { DB_PATH } = require('./config');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign key constraints
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function initSchema() {
  db.exec(`
    -- Institutes table
    CREATE TABLE IF NOT EXISTS institutes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      registration_number TEXT,
      administrator_user_id TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
      subscription_status TEXT NOT NULL DEFAULT 'trial', -- 'trial', 'active', 'past_due', 'expired'
      created_at TEXT NOT NULL
    );

    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      authentication_user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      mobile_number TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL, -- 'super_admin', 'institute_admin', 'parent', 'student'
      institute_id TEXT,
      account_status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled', 'pending'
      created_at TEXT NOT NULL,
      FOREIGN KEY (institute_id) REFERENCES institutes(id)
    );

    -- Classes table (Supports classes 1 through 12)
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      class_number INTEGER NOT NULL,
      class_name TEXT NOT NULL,
      division TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (institute_id) REFERENCES institutes(id)
    );

    -- Students table
    CREATE TABLE IF NOT EXISTS students (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      admission_number TEXT,
      account_status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive'
      created_at TEXT NOT NULL,
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    -- Parent-Student links (One parent can have multiple linked children)
    CREATE TABLE IF NOT EXISTS parent_student_links (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      parent_user_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      authorized_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(parent_user_id, student_id),
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (parent_user_id) REFERENCES users(id),
      FOREIGN KEY (student_id) REFERENCES students(id)
    );

    -- Routines table
    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      routine_name_ml TEXT NOT NULL,
      routine_name_en TEXT,
      category TEXT NOT NULL, -- 'prayer', 'quran', 'adhkar', 'routine'
      is_prayer INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      display_order INTEGER NOT NULL DEFAULT 1,
      effective_start_date TEXT,
      effective_end_date TEXT,
      FOREIGN KEY (institute_id) REFERENCES institutes(id)
    );

    -- Routine Class Assignments
    CREATE TABLE IF NOT EXISTS routine_class_assignments (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      class_id TEXT,
      applies_to_all_classes INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (routine_id) REFERENCES routines(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    -- Daily Routine Records
    CREATE TABLE IF NOT EXISTS daily_routine_records (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      routine_id TEXT NOT NULL,
      activity_date TEXT NOT NULL, -- YYYY-MM-DD
      status TEXT NOT NULL, -- 'completed', 'not_completed', 'not_recorded', 'excused'
      recorded_by_user_id TEXT NOT NULL,
      recorded_by_role TEXT NOT NULL, -- 'parent', 'institute_admin'
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      UNIQUE(student_id, routine_id, activity_date),
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (student_id) REFERENCES students(id),
      FOREIGN KEY (routine_id) REFERENCES routines(id),
      FOREIGN KEY (recorded_by_user_id) REFERENCES users(id)
    );

    -- Mentors table (institute staff assigned to specific classes)
    CREATE TABLE IF NOT EXISTS mentors (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      user_id TEXT NOT NULL,          -- FK to users (role = 'mentor')
      display_name TEXT NOT NULL,
      mobile_number TEXT NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled'
      temp_password_hash TEXT,        -- hashed initial password set by admin
      created_at TEXT NOT NULL,
      UNIQUE(user_id),
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Mentor ↔ Class many-to-many assignments
    CREATE TABLE IF NOT EXISTS mentor_class_assignments (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      mentor_id TEXT NOT NULL,
      class_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      UNIQUE(mentor_id, class_id),
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (mentor_id) REFERENCES mentors(id),
      FOREIGN KEY (class_id) REFERENCES classes(id)
    );

    -- Record Audit Logs (Immutable audit history)
    CREATE TABLE IF NOT EXISTS record_audit_logs (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      reason TEXT,
      action_timestamp TEXT NOT NULL,
      FOREIGN KEY (institute_id) REFERENCES institutes(id),
      FOREIGN KEY (record_id) REFERENCES daily_routine_records(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    -- Institute Settings
    CREATE TABLE IF NOT EXISTS institute_settings (
      institute_id TEXT PRIMARY KEY,
      parent_recording_enabled INTEGER NOT NULL DEFAULT 1,
      student_read_only_enabled INTEGER NOT NULL DEFAULT 1,
      record_edit_deadline TEXT, -- HH:MM or NULL
      allowed_backdate_days INTEGER NOT NULL DEFAULT 7,
      administrator_approval_for_corrections INTEGER NOT NULL DEFAULT 0,
      timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      excused_status_enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (institute_id) REFERENCES institutes(id)
    );

    -- Subscription and Payment Verifications
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id TEXT PRIMARY KEY,
      institute_id TEXT NOT NULL,
      plan_name TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_reference TEXT NOT NULL,
      payment_proof_note TEXT,
      payment_status TEXT NOT NULL DEFAULT 'submitted', -- 'submitted', 'verified', 'rejected'
      verified_by_user_id TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (institute_id) REFERENCES institutes(id)
    );
  `);
}

// Transaction helper for atomic operations
function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = fn(db);
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

initSchema();

module.exports = {
  db,
  initSchema,
  withTransaction
};
