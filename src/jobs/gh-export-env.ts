// GitHub Actions helper: copies every repository Variable, plus the Secrets
// listed in `secret-keys.ts`, into the environment of the following steps.
// A new Variable needs no workflow edit; a new Secret must be added to that
// list and to each workflow's "Load settings" step. Secrets win over variables.
import { appendFileSync } from "node:fs";
import { SECRET_KEYS } from "./secret-keys.ts";

const target = process.env.GITHUB_ENV;
if (!target) throw new Error("Only meant to run inside GitHub Actions");

const vars = JSON.parse(process.env.VARS_JSON || "{}") as Record<string, string>;
const secrets: Record<string, string> = {};
for (const key of SECRET_KEYS) {
  const value = process.env[key];
  if (value) secrets[key] = value;
}
const merged: Record<string, string> = { ...vars, ...secrets };

let count = 0;
for (const [key, value] of Object.entries(merged)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value === "") continue;
  const delimiter = `EOF_${crypto.randomUUID()}`;
  appendFileSync(target, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  count++;
}
console.log(`Exported ${count} settings: ${Object.keys(merged).filter((k) => merged[k]).sort().join(", ")}`);
