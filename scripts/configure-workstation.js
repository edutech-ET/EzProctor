const fs = require("fs");
const path = require("path");

const rawUrl = process.argv[2] || process.env.EZPROCTOR_SERVER_URL || "";
let serverUrl;
try {
  serverUrl = new URL(rawUrl);
} catch (_error) {
  console.error("Usage: npm run configure:workstation -- http://EDUCATOR-PC-IP:8787");
  process.exit(1);
}

if (!/^https?:$/.test(serverUrl.protocol) || ["localhost", "127.0.0.1", "::1"].includes(serverUrl.hostname)) {
  console.error("Use the educator server's LAN IP or HTTPS hostname, not localhost.");
  process.exit(1);
}

serverUrl.pathname = "";
serverUrl.search = "";
serverUrl.hash = "";
const outputPath = path.resolve(__dirname, "..", "electron", "workstation-resources", "workstation-config.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ serverUrl: serverUrl.toString().replace(/\/$/, "") }, null, 2)}\n`);
console.log(`Workstation installer configured for ${serverUrl.toString().replace(/\/$/, "")}`);
