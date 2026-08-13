const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const educationalKeys = require("./educationalKeys.json");

const dataDir = process.env.CLOUDIDE_SECURE_DATA_DIR
  ? path.resolve(process.env.CLOUDIDE_SECURE_DATA_DIR)
  : path.resolve(__dirname, "..", "data");
const activationPath = path.join(dataDir, "activation.json");
const allowedHashes = new Map(educationalKeys.map((entry) => [entry.sha256, entry.id]));

function normalizeKey(value = "") {
  return String(value).trim().toUpperCase().replace(/\s+/g, "");
}

function hashKey(value) {
  return crypto.createHash("sha256").update(normalizeKey(value)).digest("hex");
}

function readActivation() {
  try {
    const activation = JSON.parse(fs.readFileSync(activationPath, "utf8"));
    return activation?.keyId && allowedHashes.has(activation.keyHash) ? activation : null;
  } catch (_error) {
    return null;
  }
}

function activationStatus() {
  const activation = readActivation();
  return activation
    ? { activated: true, keyId: activation.keyId, institution: activation.institution, activatedAt: activation.activatedAt }
    : { activated: false };
}

function activatePlatform({ key, institution, contactEmail = "" }) {
  const normalizedInstitution = String(institution || "").trim();
  if (!normalizedInstitution) throw new Error("Institution name is required.");

  const keyHash = hashKey(key);
  const keyId = allowedHashes.get(keyHash);
  if (!keyId) throw new Error("Activation key is invalid.");

  const activation = {
    keyId,
    keyHash,
    institution: normalizedInstitution.slice(0, 160),
    contactEmail: String(contactEmail || "").trim().slice(0, 200),
    activatedAt: new Date().toISOString(),
    license: "EzProctor Educational Institution License 1.0"
  };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(activationPath, `${JSON.stringify(activation, null, 2)}\n`, { mode: 0o600 });
  return activationStatus();
}

module.exports = { activatePlatform, activationStatus };
