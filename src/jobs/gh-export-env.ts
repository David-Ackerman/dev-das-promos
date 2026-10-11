// GitHub Actions helper: copies every repository Variable and Secret into the
// environment of the following steps, so adding a setting in GitHub is all
// you ever need to do (no workflow edits). Secrets win over variables.
import { appendFileSync } from "node:fs";

const target = process.env.GITHUB_ENV;
if (!target) throw new Error("Only meant to run inside GitHub Actions");

const vars = JSON.parse(process.env.VARS_JSON || "{}") as Record<string, string>;
const secrets = JSON.parse(process.env.SECRETS_JSON || "{}") as Record<string, string>;
const merged: Record<string, string> = { ...vars, ...secrets };
delete merged.github_token;
delete merged.GITHUB_TOKEN;

let count = 0;
for (const [key, value] of Object.entries(merged)) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key) || value === "") continue;
  const delimiter = `EOF_${crypto.randomUUID()}`;
  appendFileSync(target, `${key}<<${delimiter}\n${value}\n${delimiter}\n`);
  count++;
}
console.log(`Exported ${count} settings: ${Object.keys(merged).filter((k) => merged[k]).sort().join(", ")}`);
