# CloudIDE Secure Pro User Guide

This guide is organized by role:
- Admin (system owner / IT operator)
- Teacher (exam operator and grader)
- Student (exam taker)

## Role Screenshots

### Admin / System Landing
![System landing](screenshots/home-landing.png)

### Teacher Command Center
![Teacher command center](screenshots/teacher-admin-command-center.png)

### Student Login Screen
![Student exam login](screenshots/student-login-exam-mode.png)

### Student Exam IDE
![Student IDE](screenshots/student-ide.png)

## 1. Admin Guide

### 1.1 Purpose
Admin is responsible for deploying the platform, keeping services online, and handing the teacher the correct URLs.

### 1.2 Start The System (Local Development)
1. Open terminal in project root.
2. Install dependencies:
   - `npm install`
3. Start all services:
   - `npm run dev`
4. Confirm URLs:
   - Student entry page: `http://127.0.0.1:8787/exam-mode`
   - Teacher command center: `http://127.0.0.1:8787/admin`
   - Teacher React dashboard: `http://127.0.0.1:5173` (or `http://127.0.0.1:8787/admin-app` if built)

### 1.3 Start With Docker (Recommended For Consistent Runtime)
1. Build and run:
   - `docker compose up --build`
2. Open:
   - `http://localhost:8787/exam-mode`
   - `http://localhost:8787/admin`
   - `http://localhost:8787/admin-app`

### 1.4 Environment And Runtime Notes
- Python and Rust execution are supported by backend runtime.
- Rust fallback is configured to handle missing `link.exe` by using GNU toolchain path when available.
- Persistent exam/session data is stored under `backend/data` (or Docker volume `cloudide_data`).

### 1.5 Pre-Exam Checklist (Admin)
1. Verify backend health endpoint: `http://127.0.0.1:8787/health`
2. Verify teacher can open `/admin`
3. Verify student can open `/exam-mode`
4. Run one quick Python and Rust test session before real exam
5. Confirm system clock/timezone is correct on host machine

## 2. Teacher Guide

### 2.1 Teacher Workflow Summary
1. Create Exam Template
2. Create Session
3. Add/Import Students
4. Assign Students to Session
5. Start Session and Monitor Live Activity
6. Review and Grade Submissions

### 2.2 Open Teacher Command Center
- URL: `http://127.0.0.1:8787/admin`

### 2.3 Create Exam
1. In **Step 1 – Build The Exam**, fill:
   - Exam title (required)
   - Timer (default 90 min)
   - Optional advanced settings:
     - Test type
     - Language (Python/Rust/etc.)
2. Add questions by one of these methods:
   - Manual Question Builder
   - Import CSV/JSON
   - Import Word (`.docx/.txt/.md`)
   - AI generation
3. Click **Save Exam Template**.
4. Confirm exam appears under **Saved Exams**.

### 2.4 Create Session
1. Go to **Step 2A – Open A Session**.
2. Select exam template.
3. Optional:
   - Session name
   - Expected student count
4. Click **Create Session**.
5. In **Session Control**, click **Start** when students are ready.
6. Click **Stop** at exam end (this closes session and finalizes unsubmitted work).

### 2.5 Add Students
Option A: Import CSV (recommended)
1. Go to **Step 2B – Add Students**.
2. Upload CSV with columns:
   - `studentNumber,fullName,email`
3. Click **Import Student List**.

Option B: Manual
1. Fill student number, full name, optional email.
2. Click **Create Student**.

### 2.6 Assign Students To Session
1. Go to **Step 2C – Assign Students To A Session**.
2. Choose session and student.
3. Optional seat label.
4. Click **Assign Student**.

Quick option:
- Use **Quick Operations**:
  - Create Exam
  - Create + Start Session
  - Assign All Students

### 2.7 Student Launch Instruction (Teacher To Share)
Send students this URL:
- `http://127.0.0.1:8787/exam-mode`

Tell students:
1. Enter Student ID and Full Name exactly as registered.
2. Click **Verify and Launch App**.
3. Work in IDE and submit before timer ends.

### 2.8 Live Monitoring
Teacher can monitor:
- Live activity cards
- Progress, integrity signals, violations
- Lobby check-ins
- Submission status

### 2.9 Review And Grading
1. Open **Submissions** panel.
2. Click **View** for a student.
3. In **Submission Inspector**:
   - Select file to inspect
   - Enter score
   - Set review status
   - Add feedback
4. Click **Save Grade**.
5. Optional: click **Download** for full JSON hand-in.

## 3. Student Guide

### 3.1 Student Login
1. Open: `http://127.0.0.1:8787/exam-mode`
2. Enter:
   - Student ID (student number)
   - Full name (must match registration)
3. Click **Verify and Launch App**.

### 3.2 Inside The Exam IDE
1. Confirm timer and exam title.
2. Use file panel to open/edit code file.
3. Use **Run** to test code.
4. Use question navigation (Previous/Next/Flag/Mark Answered).
5. Use **Save** regularly (autosave is also active).

### 3.3 File Rules During Exam
- Python exam: only `.py` files
- Rust exam: only `.rs` files
- Main file is preserved by exam mode rules
- Additional module files can be added and renamed with valid extension

### 3.4 Submit
1. Click **Submit**.
2. Review summary modal.
3. Click final submit confirmation.
4. System exits exam mode after successful submission.

If time reaches zero:
- The system auto-submits and exits.

## 4. Troubleshooting

### 4.1 Student Cannot Login
- Check student was added to roster and assigned to session.
- Confirm session is scheduled/active.
- Confirm entered full name matches registered name exactly.

### 4.2 Rust Compile Error
- If error shows missing `link.exe`, confirm runtime fallback toolchain is present.
- Restart backend after toolchain/environment changes.

### 4.3 No Live Data In Teacher View
- Verify backend is running (`/health`).
- Refresh `/admin`.
- Confirm WebSocket connectivity (status pill in UI).

## 5. Operational Best Practices
1. Create and test one mock exam before real exam day.
2. Lock final question set before students enter.
3. Keep one support operator on standby during first 10 minutes.
4. Export submissions after exam end for backup.
