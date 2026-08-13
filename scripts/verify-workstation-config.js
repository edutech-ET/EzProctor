const fs = require("fs");
const path = require("path");

const configPath = path.resolve(__dirname, "..", "electron", "workstation-resources", "workstation-config.json");
if (!fs.existsSync(configPath)) {
  console.error("Configure the workstation server first: npm run configure:workstation -- http://EDUCATOR-PC-IP:8787");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const url = new URL(config.serverUrl);
if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  console.error("Workstation installers cannot target localhost.");
  process.exit(1);
}
console.log(`Building workstation installer for ${config.serverUrl}`);
