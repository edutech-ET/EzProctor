# CloudIDE Secure Pro

CloudIDE Secure Pro is a desktop coding exam platform that combines:

- An Electron lockdown client
- A built-in Python and Rust CloudIDE exam workspace
- A Node.js monitoring backend with WebSocket streaming
- A React teacher dashboard
- A native Windows keyboard hook addon for OS-level shortcut blocking

## Workspace layout

- `electron/`: desktop lockdown client
- `backend/`: exam session APIs, event ingest, risk engine, live stream server
- `dashboard/`: teacher monitoring panel
- `native/keyboard-hook/`: Windows native addon
- `docs/`: role-based user guides and operational docs

## User Guides

- Role-based guide (Admin, Teacher, Student): [docs/USER_GUIDE.md](docs/USER_GUIDE.md)

## Development

1. Install dependencies at the repo root with `npm install`
2. Copy `.env.example` to `.env` and update values
3. Run `npm run dev`

This starts:

- Backend and exam IDE on `http://localhost:8787`
- Dashboard on `http://localhost:5173`
- Electron client once both services are available

Rust note:
- To run Rust exam code, install Rust so `rustc` is available on PATH (or set `RUSTC_EXECUTABLE` in `.env`).
- Rust exam workspaces use `Cargo.toml` and `src/main.rs`. If a prior Python file exists, it is retained and Rust files are scaffolded automatically.

## Native hook build

The Windows lockdown layer is optional during frontend/backend development.

Build it with:

```powershell
npm run build:native
```

If the addon is unavailable, the Electron app still launches and reports that native lockdown is not active.

## Packaging

Build the dashboard bundle and Windows installer:

```powershell
npm run build
```

Installer output:

- `dist/CloudIDE Secure Pro Setup.exe`

## Docker

Run the backend + admin UI in one container:

```powershell
docker compose up --build
```

Open:

- `http://localhost:8787/` (student exam pages)
- `http://localhost:8787/admin` (teacher admin)
- `http://localhost:8787/admin-app` (React dashboard)

Notes:
- Container persists database files in a named volume mounted at `/app/backend/data`.
- Runtime includes `python3`, `rustc`, and `cargo` for Python/Rust exam execution.

## Netlify Project Website

This repo includes a dedicated project-introduction site in:

- `marketing-site/`

Netlify configuration is already added in:

- `netlify.toml` (publish directory set to `marketing-site`)

Deploy steps:
1. Push this repo to GitHub.
2. In Netlify, click **Add new site** -> **Import from Git**.
3. Select this repository.
4. Build settings:
   - Build command: leave empty
   - Publish directory: `marketing-site`
5. Deploy site.

## GitHub Upload

If this folder is not yet a git repo:

```powershell
git init
git add .
git commit -m "feat: dockerize cloudide secure pro"
```

Create your repository on GitHub, then push:

```powershell
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

## Security notes

- Electron enforces domain allow-list navigation
- Exam tokens are injected through a preload-safe bridge
- The native addon is the only layer meant to block Windows shortcuts
- Browser-only controls are not sufficient for high-stakes exams
- You should pair this app with kiosk policies, device enrollment, and admin privileges in production
