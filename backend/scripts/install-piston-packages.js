// Installs the editor's languages into the self-hosted Piston (docker compose service "piston").
// Usage: npm run piston:install   (PISTON_URL defaults to http://localhost:2000)
import http from "node:http";

const PISTON_URL = process.env.PISTON_URL || "http://localhost:2000";
const LANGUAGES = ["node", "typescript", "python", "java", "gcc"];

const compareVersions = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
};

// Piston answers an install only once the package is unpacked: gcc alone takes more than
// the 5 minutes global fetch waits for response headers. node:http has no such limit.
const postJson = (url, payload) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json" } }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end(JSON.stringify(payload));
  });

const res = await fetch(`${PISTON_URL}/api/v2/packages`);
if (!res.ok) throw new Error(`Piston answered ${res.status} — is the container running?`);
const packages = await res.json();

let failures = 0;
for (const language of LANGUAGES) {
  const versions = packages.filter((p) => p.language === language);
  if (versions.length === 0) {
    console.log(`not available: ${language}`);
    continue;
  }
  if (versions.some((p) => p.installed)) {
    console.log(`already installed: ${language}`);
    continue;
  }
  const latest = versions.sort((a, b) => compareVersions(b.language_version, a.language_version))[0];
  console.log(`installing ${language} ${latest.language_version}…`);
  try {
    const status = await postJson(`${PISTON_URL}/api/v2/packages`, { language, version: latest.language_version });
    const ok = status >= 200 && status < 300;
    if (!ok) failures++;
    console.log(ok ? `installed ${language} ${latest.language_version}` : `failed ${language}: HTTP ${status}`);
  } catch (err) {
    failures++;
    console.log(`failed ${language}: ${err.message}`);
  }
}
process.exitCode = failures ? 1 : 0;
