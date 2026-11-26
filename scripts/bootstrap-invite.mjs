import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.includes("--local") === args.includes("--remote")) {
  process.stderr.write("Choose exactly one of --local or --remote.\n");
  process.exit(2);
}
const code = randomBytes(32).toString("base64url");
const digest = createHash("sha256").update(code).digest("hex");
const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
const command = `INSERT INTO invitations(digest,role,expires)
SELECT '${digest}','admin',${expires}
WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE role='admin' AND active=1)
AND NOT EXISTS(SELECT 1 FROM invitations WHERE role='admin' AND redeemed_at IS NULL AND expires>unixepoch()) RETURNING 1 AS created;`;
const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "khat-accounts",
  ...args, "--json", "--command", command], { encoding: "utf8" });
if (result.status !== 0) {
  process.stderr.write(result.stderr || "Wrangler did not complete.\n");
  process.exit(result.status ?? 1);
}
const rows = JSON.parse(result.stdout);
if (!rows.some(row => row.results?.some(item => item.created === 1))) {
  process.stderr.write("An active admin or an unexpired bootstrap invitation already exists.\n");
  process.exit(1);
}
process.stdout.write(`Administrator invitation (valid for 24 hours): ${code}\n`);
