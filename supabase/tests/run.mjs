// Runs every database test file (rls.mjs, profiles.mjs, party.mjs, …) one after another: `bun run test:db`.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = new URL('./', import.meta.url).pathname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs') && !['setup.mjs', 'run.mjs'].includes(f)).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n══ ${f}`);
  const r = spawnSync(process.execPath, [dir + f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
