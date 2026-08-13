const fs = require("fs");
const path = require("path");

const outputPath = path.resolve(__dirname, "..", "electron", "workstation-resources", "workstation-config.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ deploymentMode: "central-server", serverUrl: "" }, null, 2)}\n`);
console.log("Public workstation installer configured for first-launch server setup.");
