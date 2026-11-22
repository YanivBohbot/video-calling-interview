// Installs the editor's languages into the self-hosted Piston (docker compose service "piston").
// Usage: npm run piston:install   (PISTON_URL defaults to http://localhost:2000)
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

const res = await fetch(`${PISTON_URL}/api/v2/packages`);
if (!res.ok) throw new Error(`Piston answered ${res.status} — is the container running?`);
const packages = await res.json();

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
  const install = await fetch(`${PISTON_URL}/api/v2/packages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ language, version: latest.language_version }),
  });
  console.log(install.ok ? `installed ${language} ${latest.language_version}` : `failed ${language}: ${install.status}`);
}
