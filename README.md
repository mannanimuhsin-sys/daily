# 🕌 Islamic Daily Prayer & Routine Tracker (v2.0)
### Parent-Controlled Daily Tracking & Madrasa Management Platform
**രക്ഷിതാക്കളുടെ മേൽനോട്ടത്തിലുള്ള നമസ്കാര & ദിനചര്യ ട്രാക്കിംഗ് സിസ്റ്റം**

---

## 🌟 Core Operating Principle

1. **Parent-Controlled Authority**: Parents or authorized guardians are responsible for asking their children about their daily prayers and recording the answers in the application.
2. **Student Read-Only Access**: Students cannot create, alter, or delete prayer records. Strict read-only authorization is enforced on the database and backend API levels.
3. **Institute Administrator Oversight**: Institute administrators can review student records, filter for missing/unrecorded entries, and perform administrative corrections with a **mandatory correction reason**.
4. **Transparent Attribution**: Every record explicitly distinguishes between a **Parent-reported record** (`recorded_by_role: 'parent'`) and an **Administrator-corrected record** (`recorded_by_role: 'institute_admin'`).
5. **Immutable Audit History**: Every creation, status update, and correction generates an audit entry in `record_audit_logs` tracking previous status, new status, actor, timestamp, and justification reason.

---

## 🚀 Quick Start & Running Locally

### 1. Install & Start
```powershell
cd c:\daily
npm start
```
The server starts at **`http://localhost:3000`** using Node's built-in `node:sqlite` database with zero external compilation dependencies!

### 2. Run Acceptance Test Suite
```powershell
npm test
```
All **12 Mandatory Acceptance Tests** execute and verify database constraints, cross-child isolation, read-only permissions, and multi-tenant security.

### 3. Run End-to-End Simulation
```powershell
node test/e2e_simulation.js
```

---

## 🔑 Demo Test Accounts

| Role | Mobile Number | Password | Notes |
|------|---------------|----------|-------|
| **Parent** | `9447333444` | `Parent@123` | **Abdul Rahman**: Has 2 linked children (**Muhammed Bilal** in Class 4-A and **Fathima Zahra** in Class 7-B). Test child switcher! |
| **Institute Admin** | `9847111222` | `Admin@123` | **Usthad Ahmad**: Principal of Al-Huda Islamic Academy. Review records, correct entries with reasons, manage custom routines & classes. |
| **Student** | `9000111222` | `Student@123` | **Muhammed Bilal**: Read-only progress viewing. All mutation attempts return `403 Forbidden`. |
| **Super Admin** | `9999900000` | `SuperAdmin@123` | Manage institute registrations, approve/reject madrasas, verify subscription payments. |

---

## 📊 Database Entities & Schema

The application implements the exact 10 entities specified in the requirements:

1. **`institutes`**: `id`, `name`, `registration_number`, `administrator_user_id`, `approval_status`, `subscription_status`, `created_at`
2. **`users`**: `id`, `authentication_user_id`, `display_name`, `mobile_number`, `password_hash` (secure crypto scrypt), `role`, `institute_id`, `account_status`, `created_at`
3. **`classes`**: `id`, `institute_id`, `class_number` (1 to 12), `class_name`, `division`, `is_active`
4. **`students`**: `id`, `institute_id`, `class_id`, `student_name`, `admission_number`, `account_status`, `created_at`
5. **`parent_student_links`**: `id`, `institute_id`, `parent_user_id`, `student_id`, `is_active`, `authorized_by`, `created_at` (Supports 1 parent to multiple children)
6. **`routines`**: `id`, `institute_id`, `routine_name_ml`, `routine_name_en`, `category`, `is_prayer`, `is_active`, `display_order`, `effective_start_date`, `effective_end_date`
7. **`routine_class_assignments`**: `id`, `institute_id`, `routine_id`, `class_id`, `applies_to_all_classes` (Guarantees class applicability without hardcoding)
8. **`daily_routine_records`**: `id`, `institute_id`, `student_id`, `routine_id`, `activity_date`, `status`, `recorded_by_user_id`, `recorded_by_role`, `created_at`, `updated_at`, `version` (Unique constraint on `(student_id, routine_id, activity_date)`)
9. **`record_audit_logs`**: `id`, `institute_id`, `record_id`, `actor_user_id`, `actor_role`, `previous_status`, `new_status`, `reason`, `action_timestamp` (Immutable history)
10. **`institute_settings`**: `institute_id`, `parent_recording_enabled`, `student_read_only_enabled`, `record_edit_deadline`, `allowed_backdate_days`, `administrator_approval_for_corrections`, `timezone` (Default: `Asia/Kolkata`)
11. **`subscription_payments`**: `id`, `institute_id`, `plan_name`, `amount`, `payment_reference`, `payment_proof_note`, `payment_status`, `verified_by_user_id`, `verified_at`, `created_at`

---

## 🕋 Five Daily Prayers

Explicit status selector with zero auto-marking:

- **Fajr — സുബ്ഹ്**
- **Dhuhr — ളുഹർ**
- **Asr — അസർ**
- **Maghrib — മഗ്രിബ്**
- **Isha — ഇശാ**

### Supported Statuses:
- **Completed** (`completed`): Prayer offered on time.
- **Not completed** (`not_completed`): Prayer was not offered.
- **Excused / Not applicable** (`excused`): Legitimate excuse / not applicable.
- **Not recorded** (`not_recorded`): Unanswered/unrecorded entry. **Never automatically counted as missed!**

---

## 🛡️ Security & Backend Invariants

- **Multi-Child Isolation**: Parent write operations authenticate token identity and verify active link in `parent_student_links` on every request. Parents cannot write for other parents' children.
- **Multi-Tenant Partitioning**: Admins from Institute A can never query or mutate records belonging to Institute B.
- **Read-Only Enforcement**: Student accounts are prevented from mutating database records by server-side role middleware.
- **Date Restraints**: Cannot submit future dates. Historical entries strictly bounded by `allowed_backdate_days` and `record_edit_deadline`.
- **Atomic Transactions**: Updates to daily records and creation of audit events execute within atomic SQLite transactions.
