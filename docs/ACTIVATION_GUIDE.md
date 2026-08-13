# EzProctor Educational Activation Guide

EzProctor is free for licensed educational institutions. The central platform server must be activated once before educator login, student check-in, or exam APIs are available.

## 1. Request a free key

Email [eozoe2025@gmail.com](mailto:eozoe2025@gmail.com?subject=EzProctor%20Educational%20Activation%20Key%20Request&body=Institution%20name%3A%0ACountry%3A%0AContact%20name%3A%0AContact%20email%3A%0AEducational%20use%3A%0A) with:

- Institution name and country
- Contact name and institutional email
- Brief description of the educational use
- Expected number of student workstations

Do not publish or commit an issued key. A key is for the authorized institution only.

## 2. Install and activate

1. Deploy EzProctor with Docker or the native server instructions.
2. Open `http://SERVER-IP:8787/admin-app/`.
3. Enter the institution name, optional contact email, and activation key.
4. Select **Activate platform**.
5. Sign in with the configured educator account.

Activation is performed on the central server. Every student Electron workstation connected to that server is covered; do not enter a key on each workstation.

## 3. Verify activation

Check the status endpoint:

```powershell
Invoke-RestMethod http://SERVER-IP:8787/api/activation/status
```

An activated server returns `activated: true`, the institution name, key ID, and activation time. It never returns the plaintext key.

## 4. Persistence and backup

Activation is stored as `activation.json` in the same persistent data directory as the EzProctor database. Docker deployments retain it in the `ezproctor_data` volume.

Back up the data volume before upgrades or server migration. If the data volume is deleted, activate the replacement server again with the institution's authorized key or request assistance by email.

## 5. Troubleshooting

- **Invalid key:** remove spaces introduced during copying and verify every group.
- **Too many attempts:** wait 15 minutes after ten unsuccessful attempts.
- **Activation disappeared:** verify the Docker volume or `CLOUDIDE_SECURE_DATA_DIR` was preserved.
- **Student redirected to activation:** activate the central server, then reload the student application.
- **Need a replacement key:** email `eozoe2025@gmail.com` with the institution name and reason.

## License

Copyright © 2026 Ejoe Tso. Use is governed by the [EzProctor Educational Institution License](../LICENSE).
