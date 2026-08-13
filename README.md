# EzProctor Exam

EzProctor Exam is an educator-controlled coding assessment platform with exam authoring, secure student check-in, Python/Rust/HTML execution, autosaved question responses, live session monitoring, grading, and PDF answer books.

![Educator console](docs/screenshots/teacher-admin-command-center.png)

## Quick Start with Docker

```bash
git clone https://github.com/edutech-ET/EzProctor.git
cd EzProctor
cp .env.example .env
docker compose up -d --build
```

Open the educator console at `http://localhost:8787/admin-app/` and the student check-in page at `http://localhost:8787/exam-mode`.

On first launch, activate the central EzProctor server with an educational institution key. Request a free key from [eozoe2025@gmail.com](mailto:eozoe2025@gmail.com?subject=EzProctor%20Educational%20Activation%20Key%20Request), then enter the institution name, contact email, and key on the activation screen. Student workstations do not need separate keys.

Default educator login for initial setup: `ezproctor` / `admin@123`. Change these values in `.env` before production use.

## Product Videos

| Walkthrough | Description |
| --- | --- |
| [Implementation video](docs/videos/implementation-guide.mp4) | Docker deployment, configuration, validation, backup, and upgrades |
| [Educator demo](docs/videos/educator-demo.mp4) | Question import, model answers, sessions, grading, and PDF export |
| [Student demo](docs/videos/student-demo.mp4) | Check-in, question navigation, Python testing, autosave, and submission |

GitHub displays MP4 links as downloadable/playable repository assets.

## Guides

- [Installation Guide](docs/INSTALLATION_GUIDE.md)
- [Implementation Guide](docs/IMPLEMENTATION_GUIDE.md)
- [Workstation Setup Guide](docs/WORKSTATION_SETUP_GUIDE.md)
- [Activation Guide](docs/ACTIVATION_GUIDE.md)
- [Role-Based User Guide](docs/USER_GUIDE.md)

## Core Capabilities

- Import questions from Word, Markdown, text, CSV, and JSON.
- Ignore introductions, candidate rules, procedures, and other non-question content.
- Classify coding, frontend, debugging, multiple-choice, short, and long questions.
- Import and review model-answer mappings for advisory pre-grading.
- Create sessions, assign learners, approve check-ins, and release exams.
- Run Python and Rust code or refresh an HTML preview during practical exams.
- Keep the latest official answer for every student and question synchronized.
- Grade question by question or save all marks and feedback together.
- Export individual student, session-wide, and exam-wide PDF answer books.
- Run as a Docker web deployment or Electron student desktop client.

## Screenshots

### Student Check-In

![Student check-in](docs/screenshots/student-login-exam-mode.png)

### Student IDE

![Student IDE](docs/screenshots/student-ide.png)

## Architecture

```mermaid
flowchart LR
  Educator[Educator Browser] --> App[EzProctor API + Dashboard]
  Student[Student Electron Client] --> App
  App --> DB[(SQLite Volume)]
  App --> Python[Python Runner]
  App --> Rust[Rust Runner]
  App --> HTML[HTML Preview]
```

The Docker image includes Python and Rust. Native Windows Rust execution requires Visual Studio Build Tools with the C++ workload when using the MSVC Rust target.

## Development

```powershell
npm ci
npm run build:dashboard
npm run dev:backend
```

For the complete Electron development stack:

```powershell
npm run dev
```

Build the Windows student installer:

```powershell
npm run build:student
```

## Data and Security

- Application data is stored in `backend/data` locally or the `ezproctor_data` Docker volume.
- `.env`, databases, logs, temporary files, and exported student records are excluded from Git.
- Production should be placed behind HTTPS and restricted to trusted networks.
- Advisory grading never finalizes marks without educator confirmation.
- Organizations must define retention, privacy, accessibility, and invigilation procedures appropriate to local requirements.

## Validation

```bash
docker compose config
npm run build:dashboard
node --check backend/src/server.js
```

A full Docker image build additionally requires a running Docker engine.

## License

Copyright © 2026 Ejoe Tso.

The repository is public and source-available. EzProctor is free for licensed educational institutions, but activation is required and commercial redistribution or paid hosted use requires written permission. Because these conditions restrict fields of use, this is not an OSI-approved open-source license. See [LICENSE](LICENSE) and the [Activation Guide](docs/ACTIVATION_GUIDE.md).
