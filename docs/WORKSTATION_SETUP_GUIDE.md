# EzProctor Exam Workstation Setup Guide

This guide configures a computer laboratory where one educator server and many Windows student workstations use the same local network.

## Important: Student PCs Need Only One Installer

Do **not** install Electron, Node.js, Python, Rust, Docker, or the EzProctor source code on each student workstation.

The generated `EzProctor-Exam-Student-Setup.exe` includes Electron and is preconfigured with the central educator server address. Python and Rust code execute on the central EzProctor server. Workstations only need:

- Windows 10 or 11, 64-bit
- A connection to the same trusted network as the educator server
- The EzProctor Exam Student installer

## 1. Recommended Network Layout

```text
Educator/server PC: 192.168.8.117:8787
          |
    School LAN or dedicated exam VLAN
          |
Student PC 01 ... Student PC 30
```

Use Ethernet where possible. Give the educator server a DHCP reservation or static IP so the address does not change after installers are created.

Do not use `localhost` or `127.0.0.1` in a workstation installer. Those addresses point back to the student PC.

## 2. Educator Server Preparation

Deploy EzProctor with Docker or the native backend first. Confirm locally:

```text
http://127.0.0.1:8787/health
```

It should return:

```json
{"ok":true,"service":"cloudide-secure-backend"}
```

Find the LAN IPv4 address on the educator server:

```powershell
ipconfig
```

Look under the active Ethernet or Wi-Fi adapter. Example: `192.168.8.117`.

Open Windows Firewall port `8787` on the educator server only. Run PowerShell as Administrator:

```powershell
New-NetFirewallRule `
  -DisplayName "EzProctor Exam Server" `
  -Direction Inbound `
  -Protocol TCP `
  -LocalPort 8787 `
  -Action Allow `
  -Profile Private
```

For tighter security, add `-RemoteAddress 192.168.8.0/24` using the actual exam subnet.

From another PC on the same network, verify:

```powershell
Test-NetConnection 192.168.8.117 -Port 8787
```

Then open:

```text
http://192.168.8.117:8787/exam-mode
```

Do not continue until both checks work.

## 3. Builder PC Requirements

These tools are required only on the IT/admin PC that creates the installer:

- Node.js LTS: <https://nodejs.org/en/download>
- Git: <https://git-scm.com/download/win>
- EzProctor source: <https://github.com/edutech-ET/EzProctor>

Electron does not need a separate manual download. Running `npm ci` downloads the project-pinned Electron development dependency from the official Electron release distribution. Official references:

- Electron installation: <https://www.electronjs.org/docs/latest/tutorial/installation>
- Electron distribution overview: <https://www.electronjs.org/docs/latest/tutorial/distribution-overview>
- Official Electron releases: <https://github.com/electron/electron/releases>

## 4. Build a Preconfigured Workstation Installer

On the builder PC:

```powershell
git clone https://github.com/edutech-ET/EzProctor.git
cd EzProctor
npm ci
```

Configure the central server URL. Replace the example IP:

```powershell
npm run configure:workstation -- http://192.168.8.117:8787
```

Build the installer:

```powershell
npm run build:workstation
```

This command creates an unsigned installer for a controlled internal lab. For a production installer configured with the institution's Windows signing certificate, run:

```powershell
npm run build:workstation:signed
```

Output:

```text
dist/EzProctor-Exam-Student-0.1.0-Setup.exe
```

The build fails if the configuration is missing or points to localhost. The generated `electron/workstation-resources/workstation-config.json` is local, ignored by Git, and bundled only into the installer.

## 5. Student Workstation Installation

On each student PC:

1. Copy or centrally deploy `EzProctor-Exam-Student-0.1.0-Setup.exe`.
2. Run the installer.
3. Launch **EzProctor Exam Student** from the Start menu or desktop shortcut.
4. Confirm the student check-in page opens from the educator server.

No server URL, Electron, browser extension, compiler, source code, `.env`, or command-line setup is required on the workstation.

For many PCs, distribute the same installer through Intune, Microsoft Configuration Manager, Group Policy software deployment, or the institution's normal endpoint-management system.

## 6. Pre-Exam Workstation Acceptance Test

Test every workstation before exam day:

1. Launch EzProctor Exam Student.
2. Confirm the correct active exam appears.
3. Check in with a test learner.
4. Approve the learner from the educator console.
5. Start a practice Python question and select **Run Python**.
6. If used, test Rust and HTML questions.
7. Move between questions and confirm autosave.
8. Submit the practice attempt.
9. Confirm the educator can grade it and export the student PDF.
10. Restart the workstation and repeat the launch check.

## 7. Exam-Day Checklist

- [ ] Educator server IP has not changed.
- [ ] Docker/backend health check is successful.
- [ ] TCP port `8787` is reachable from student PCs.
- [ ] All workstations show the EzProctor check-in page.
- [ ] Correct exam and session are selected.
- [ ] Learner roster is imported and assigned.
- [ ] A spare workstation is available.
- [ ] Power-saving and forced restart policies are suspended for the exam window.
- [ ] The educator has tested submission and PDF export.

## 8. Troubleshooting

### Student app cannot connect

On the workstation:

```powershell
Test-NetConnection 192.168.8.117 -Port 8787
```

If it fails, check the server IP, Windows Firewall, VLAN/client-isolation rules, VPN/proxy settings, and whether the backend is running.

### Installer points to an old IP

Set a fixed server IP. Re-run `configure:workstation`, rebuild, and redeploy the installer. Workstations should not edit configuration manually.

### Windows SmartScreen warning

Unsigned internal installers may show a warning. For managed production deployment, code-sign the installer with the institution's trusted Windows signing certificate.

On some Windows builder PCs, Electron Builder may report that symbolic-link privilege is missing while preparing signing tools. Enable Windows Developer Mode or run the build in an approved elevated/CI environment. This is a builder-PC issue; student workstations do not need Developer Mode.

### Python or Rust missing on a student PC

No action is required on the workstation. Compilers belong on the central server/Docker image. Verify the server container instead.

### Electron download blocked while building

This affects only the builder PC. Permit npm/GitHub release downloads through the institutional proxy, run `npm ci` again, or use an approved npm mirror. Do not download random Electron binaries from third-party sites.

## 9. Security Notes

- Use a dedicated exam VLAN or trusted private network.
- Restrict server firewall access to the exam subnet.
- Use HTTPS through a reverse proxy when traffic crosses untrusted networks.
- Code-sign workstation installers before wide deployment.
- Rebuild and retest the installer whenever the server URL or application version changes.
