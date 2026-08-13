# EzProctor Exam Installation Guide

This guide covers Docker deployment and native Windows installation.

## 1. Requirements

### Docker deployment

- Docker Desktop 4.x or Docker Engine 24+
- Docker Compose v2+
- 4 GB RAM and 5 GB free storage
- TCP port `8787` available

### Native Windows deployment

- Windows 10 or 11 (64-bit)
- Node.js 20 LTS+
- Python 3.10+ for Python exams
- Rust toolchain for Rust exams
- Visual Studio Build Tools with **Desktop development with C++** for Rust MSVC linking

## 2. Docker Installation

```bash
git clone https://github.com/edutech-ET/EzProctor.git
cd EzProctor
cp .env.example .env
docker compose up -d --build
```

Open:

- Educator console: `http://localhost:8787/admin-app/`
- Student check-in: `http://localhost:8787/exam-mode`
- Health check: `http://localhost:8787/health`

The first educator-console visit opens platform activation. Request a free educational institution key from `eozoe2025@gmail.com`, enter the institution details and key, then continue to educator login. One activation covers the central server and all connected student workstations.

Default educator login:

- Username: `ezproctor`
- Password: `admin@123`

Set `EDUCATOR_USERNAME` and `EDUCATOR_PASSWORD` in `.env` before production use.

Verify deployment:

```bash
docker compose ps
docker compose logs -f ezproctor
```

Stop without deleting data:

```bash
docker compose down
```

Remove the application and its database volume only when a permanent reset is intended:

```bash
docker compose down -v
```

## 3. Environment Configuration

Copy `.env.example` to `.env`. Never commit `.env`.

- `BACKEND_PORT`: backend port; default `8787`.
- `OPENAI_API_KEY`: optional; enables AI-assisted question generation.
- `OPENAI_MODEL`: optional OpenAI model name.
- `EDUCATOR_USERNAME`: educator console username.
- `EDUCATOR_PASSWORD`: educator console password. Change the default before production use.
- `EDUCATOR_SESSION_HOURS`: educator login lifetime; default `8` hours.
- `CLOUDIDE_SECURE_DATA_DIR`: internal compatibility variable for persistent database storage.

The Docker volume `ezproctor_data` keeps exams, sessions, students, answers, and grades across container restarts.
It also stores `activation.json`; include this volume in backups to preserve activation during upgrades.

See the [Activation Guide](ACTIVATION_GUIDE.md) for key requests, first-run activation, and troubleshooting.

## 4. Native Development Installation

```powershell
npm ci
npm run build:dashboard
npm run dev:backend
```

Open `http://127.0.0.1:8787/admin-app/`.

For full development with Electron:

```powershell
npm run dev
```

## 5. Windows Student Installer

For a same-network computer laboratory and zero-setup student PCs, follow the dedicated [Workstation Setup Guide](WORKSTATION_SETUP_GUIDE.md).

Build the Electron student client:

```powershell
npm ci
npm run build:student
```

Installer output:

```text
dist/EzProctor-Exam-Student-0.1.0-Setup.msi
```

The public installer is available from the [latest GitHub Release](https://github.com/edutech-ET/EzProctor/releases/latest). Install it on each student PC. On first launch, enter the central EzProctor server URL, then confirm Python and/or Rust execution before exam day.

## 6. Upgrade and Backup

Back up Docker data:

```bash
docker run --rm -v ezproctor_data:/data -v "$PWD":/backup alpine tar czf /backup/ezproctor-data.tgz -C /data .
```

Upgrade:

```bash
git pull
docker compose up -d --build
```

## 7. Troubleshooting

- Port conflict: change the left side of `8787:8787` in `docker-compose.yml`.
- Container unhealthy: run `docker compose logs ezproctor`.
- Rust linker error on native Windows: install Visual Studio Build Tools with the C++ workload.
- Docker Rust/Python tests: both compilers are installed inside the image.
- Data missing after restart: verify the `ezproctor_data` volume still exists with `docker volume ls`.
