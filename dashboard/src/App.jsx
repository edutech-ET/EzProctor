import React, { useEffect, useState } from "react";

const backendUrl = import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8787";
const emptyArray = [];

function ensureArray(value) {
  return Array.isArray(value) ? value : emptyArray;
}

function scoreClass(score) {
  if (score >= 70) return "critical";
  if (score >= 40) return "warning";
  return "normal";
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${backendUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  return response.json();
}

export default function App() {
  const [students, setStudents] = useState([]);
  const [exams, setExams] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [roster, setRoster] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [socketState, setSocketState] = useState("Connecting");
  const [examForm, setExamForm] = useState({ title: "", testType: "Coding", language: "Python", durationMinutes: 90 });
  const [sessionForm, setSessionForm] = useState({ examId: "", sessionName: "", studentCount: 30 });
  const [studentForm, setStudentForm] = useState({ studentNumber: "", fullName: "", email: "" });
  const [registrationForm, setRegistrationForm] = useState({
    sessionId: "",
    studentId: "",
    seatLabel: ""
  });

  useEffect(() => {
    let socket;

    function applyOverview(data) {
      setStudents(ensureArray(data?.students));
      setExams(ensureArray(data?.exams));
      setSessions(ensureArray(data?.sessions));
      setRoster(ensureArray(data?.roster));
      setRegistrations(ensureArray(data?.registrations));
      setSubmissions(ensureArray(data?.submissions));
    }

    function mergeStudent(update) {
      setStudents((current) => {
        const next = [...current];
        const index = next.findIndex((item) => item.studentId === update.studentId);
        if (index >= 0) {
          next[index] = update;
        } else {
          next.push(update);
        }
        return next.sort((a, b) => b.riskScore - a.riskScore);
      });
    }

    jsonFetch("/api/dashboard/overview")
      .then((data) => {
        applyOverview(data);
        if (ensureArray(data?.exams)[0]?.id) {
          setSessionForm((current) => ({ ...current, examId: current.examId || data.exams[0].id }));
        }
        if (ensureArray(data?.sessions)[0]?.id) {
          setRegistrationForm((current) => ({ ...current, sessionId: current.sessionId || data.sessions[0].id }));
        }
        if (ensureArray(data?.roster)[0]?.id) {
          setRegistrationForm((current) => ({ ...current, studentId: current.studentId || data.roster[0].id }));
        }
        setLoadError("");
        setLoading(false);
      })
      .catch((error) => {
        console.error(error);
        setLoadError(`Failed to load dashboard overview from ${backendUrl}. ${error.message}`);
        setLoading(false);
      });

      socket = new WebSocket(`${backendUrl.replace("http", "ws")}/ws`);
    socket.onopen = () => setSocketState("Connected");
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "dashboard-bootstrap") {
        applyOverview(message.payload || {});
        return;
      }

      if (message.type === "student-event" || message.type === "student-snapshot") {
        if (message.payload?.studentId) {
          mergeStudent(message.payload);
        }
        return;
      }

      if (message.type === "exam-created") {
        setExams((current) => [message.payload, ...current]);
        return;
      }

      if (message.type === "session-created") {
        setSessions((current) => [message.payload, ...current]);
        return;
      }

      if (message.type === "student-created") {
        setRoster((current) => [message.payload, ...current]);
        return;
      }

      if (message.type === "registration-created") {
        setRegistrations((current) => [message.payload, ...current]);
        return;
      }

      if (message.type === "session-updated") {
        setSessions((current) => current.map((item) => (item.id === message.payload.id ? message.payload : item)));
        return;
      }

      if (message.type === "submission-created") {
        setSubmissions((current) => [message.payload, ...current]);
      }
    };
    socket.onerror = () => {
      setSocketState("Socket error");
    };
    socket.onclose = () => {
      setSocketState("Disconnected");
    };

    return () => socket?.close();
  }, []);

  async function handleExamSubmit(event) {
    event.preventDefault();
    const exam = await jsonFetch("/api/dashboard/exams", {
      method: "POST",
      body: JSON.stringify(examForm)
    });
    setExamForm({ title: "", testType: exam.testType, language: exam.language, durationMinutes: exam.durationMinutes });
    setSessionForm((current) => ({ ...current, examId: exam.id }));
  }

  async function handleSessionSubmit(event) {
    event.preventDefault();
    const session = await jsonFetch("/api/dashboard/sessions", {
      method: "POST",
      body: JSON.stringify(sessionForm)
    });
    setSessionForm((current) => ({ ...current, sessionName: "", examId: current.examId || session.examId }));
    setRegistrationForm((current) => ({ ...current, sessionId: session.id }));
  }

  async function handleStudentSubmit(event) {
    event.preventDefault();
    const student = await jsonFetch("/api/dashboard/students", {
      method: "POST",
      body: JSON.stringify(studentForm)
    });
    setStudentForm({ studentNumber: "", fullName: "", email: "" });
    setRegistrationForm((current) => ({ ...current, studentId: student.id }));
  }

  async function handleRegistrationSubmit(event) {
    event.preventDefault();
    await jsonFetch("/api/dashboard/registrations", {
      method: "POST",
      body: JSON.stringify(registrationForm)
    });
    setRegistrationForm((current) => ({ ...current, seatLabel: "" }));
  }

  async function updateSessionState(sessionId, action) {
    await jsonFetch(`/api/dashboard/sessions/${sessionId}/${action}`, { method: "POST" });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">CloudIDE Secure Pro</p>
        <h1>Exam Operations Dashboard</h1>
        <p className="subcopy">
          Manage exams, open and close exam sessions, verify student identity, track activity, and record submissions.
        </p>
        <div className="status-strip">
          <span className="status-pill">API {loading ? "Loading" : loadError ? "Error" : "Ready"}</span>
          <span className="status-pill">Socket {socketState}</span>
          <span className="status-pill">{exams.length} exams</span>
          <span className="status-pill">{sessions.length} sessions</span>
        </div>
        {loadError ? <p className="error-text">{loadError}</p> : null}
      </section>

      <section className="management-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Exams</h2>
            <span>{exams.length}</span>
          </div>
          <form className="stack" onSubmit={handleExamSubmit}>
            <input
              value={examForm.title}
              onChange={(event) => setExamForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Exam title"
              required
            />
            <select
              value={examForm.testType}
              onChange={(event) => setExamForm((current) => ({ ...current, testType: event.target.value }))}
            >
              <option>Coding</option>
              <option>Debugging</option>
              <option>Database</option>
              <option>Frontend</option>
              <option>Short Answer</option>
            </select>
            <select
              value={examForm.language}
              onChange={(event) => setExamForm((current) => ({ ...current, language: event.target.value }))}
            >
              <option>Python</option>
              <option>Rust</option>
              <option>JavaScript</option>
              <option>Java</option>
            </select>
            <input
              type="number"
              min="15"
              value={examForm.durationMinutes}
              onChange={(event) =>
                setExamForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))
              }
            />
            <button type="submit">Create exam</button>
          </form>
          <div className="table-list">
            {exams.map((exam) => (
              <article key={exam.id} className="list-row">
                <strong>{exam.title}</strong>
                <span>{exam.testType} | {exam.language} | {exam.durationMinutes} min | {exam.status}</span>
              </article>
            ))}
            {exams.length === 0 ? (
              <article className="empty compact-empty">
                <h3>No exams yet</h3>
                <p>Create the first exam to start scheduling sessions.</p>
              </article>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Sessions</h2>
            <span>{sessions.length}</span>
          </div>
          <form className="stack" onSubmit={handleSessionSubmit}>
            <select
              value={sessionForm.examId}
              onChange={(event) => setSessionForm((current) => ({ ...current, examId: event.target.value }))}
              required
            >
              <option value="">Choose exam</option>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>{exam.title}</option>
              ))}
            </select>
            <input
              value={sessionForm.sessionName}
              onChange={(event) => setSessionForm((current) => ({ ...current, sessionName: event.target.value }))}
              placeholder="Session name"
              required
            />
            <input
              type="number"
              min="1"
              value={sessionForm.studentCount}
              onChange={(event) =>
                setSessionForm((current) => ({ ...current, studentCount: Number(event.target.value) }))
              }
            />
            <button type="submit">Create session</button>
          </form>
          <div className="table-list">
            {sessions.map((session) => (
              <article key={session.id} className="list-row">
                <strong>{session.sessionName}</strong>
                <span>{session.accessCode} | {session.status} | {session.durationMinutes} min</span>
                <div className="action-row">
                  <button type="button" onClick={() => updateSessionState(session.id, "start")}>Start</button>
                  <button type="button" onClick={() => updateSessionState(session.id, "stop")}>Stop</button>
                </div>
              </article>
            ))}
            {sessions.length === 0 ? (
              <article className="empty compact-empty">
                <h3>No sessions yet</h3>
                <p>Create a session after you have at least one exam.</p>
              </article>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Students</h2>
            <span>{roster.length}</span>
          </div>
          <form className="stack" onSubmit={handleStudentSubmit}>
            <input
              value={studentForm.studentNumber}
              onChange={(event) => setStudentForm((current) => ({ ...current, studentNumber: event.target.value }))}
              placeholder="Student number"
              required
            />
            <input
              value={studentForm.fullName}
              onChange={(event) => setStudentForm((current) => ({ ...current, fullName: event.target.value }))}
              placeholder="Full name"
              required
            />
            <input
              value={studentForm.email}
              onChange={(event) => setStudentForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="Email"
            />
            <button type="submit">Create student</button>
          </form>
          <div className="table-list">
            {roster.map((student) => (
              <article key={student.id} className="list-row">
                <strong>{student.fullName}</strong>
                <span>{student.studentNumber} | {student.identityStatus}</span>
              </article>
            ))}
            {roster.length === 0 ? (
              <article className="empty compact-empty">
                <h3>No students yet</h3>
                <p>Add students here before assigning them to a session.</p>
              </article>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Registration</h2>
            <span>{registrations.length}</span>
          </div>
          <form className="stack" onSubmit={handleRegistrationSubmit}>
            <select
              value={registrationForm.sessionId}
              onChange={(event) => setRegistrationForm((current) => ({ ...current, sessionId: event.target.value }))}
              required
            >
              <option value="">Choose session</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>{session.sessionName}</option>
              ))}
            </select>
            <select
              value={registrationForm.studentId}
              onChange={(event) => setRegistrationForm((current) => ({ ...current, studentId: event.target.value }))}
              required
            >
              <option value="">Choose student</option>
              {roster.map((student) => (
                <option key={student.id} value={student.id}>{student.fullName}</option>
              ))}
            </select>
            <input
              value={registrationForm.seatLabel}
              onChange={(event) => setRegistrationForm((current) => ({ ...current, seatLabel: event.target.value }))}
              placeholder="Seat / machine label"
            />
            <button type="submit">Assign student</button>
          </form>
          <div className="table-list">
            {registrations.map((registration) => (
              <article key={registration.id} className="list-row">
                <strong>{registration.fullName}</strong>
                <span>
                  {registration.sessionName} | Access {registration.accessCode} | Verify {registration.verificationCode}
                </span>
              </article>
            ))}
            {registrations.length === 0 ? (
              <article className="empty compact-empty">
                <h3>No registrations yet</h3>
                <p>Assign a student to a session to generate access and verification codes.</p>
              </article>
            ) : null}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Live Activity</h2>
          <span>{students.length} active</span>
        </div>
        <div className="grid">
          {students.map((student) => (
            <article key={student.studentId} className="card">
              <div className="card-header">
                <div>
                  <h3>{student.studentName}</h3>
                  <p>{student.examId}</p>
                </div>
                <span className={`badge ${scoreClass(student.riskScore)}`}>{student.status}</span>
              </div>
              <div className="metrics">
                <div>
                  <span>Progress</span>
                  <strong>{student.progress}%</strong>
                </div>
                <div>
                  <span>Violations</span>
                  <strong>{student.violations}</strong>
                </div>
                <div>
                  <span>Integrity</span>
                  <strong>{100 - student.riskScore}</strong>
                </div>
              </div>
              <div className="activity">
                <span>Current activity</span>
                <strong>{student.currentActivity}</strong>
              </div>
              <div className="activity">
                <span>Signals</span>
                <strong>{student.signals?.length ? student.signals.join(", ") : "No elevated signals"}</strong>
              </div>
              <div className="activity">
                <span>Submission</span>
                <strong>{student.submitted ? "Submitted" : "In progress"}</strong>
              </div>
            </article>
          ))}
          {students.length === 0 ? (
            <article className="empty">
              <h3>No active students</h3>
              <p>Live activity cards will appear here once a student enters the IDE.</p>
            </article>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Submissions</h2>
          <span>{submissions.length} recorded</span>
        </div>
        <div className="table-list">
          {submissions.map((submission) => (
            <article key={submission.id} className="list-row">
              <strong>{submission.fullName}</strong>
              <span>{submission.sessionName} | {submission.submittedAt} | {submission.status}</span>
            </article>
          ))}
          {submissions.length === 0 ? (
            <article className="empty">
              <h3>No submissions yet</h3>
              <p>Final student submissions will appear here once the exam is submitted.</p>
            </article>
          ) : null}
        </div>
      </section>
    </main>
  );
}
