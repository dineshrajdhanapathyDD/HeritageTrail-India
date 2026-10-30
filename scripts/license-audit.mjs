#!/usr/bin/env node
// Production dependency licence audit for the npm workspaces tree.
// Lists every package that `npm ls --omit=dev --all` resolves, reads its package.json licence and prints a summary.
// Exit code 1 if any non-private package has a licence outside PERMISSIVE and REVIEWED (review those by hand).
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PERMISSIVE = new Set([
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0',
  'Python-2.0',
]);
// Licences reviewed by hand and accepted for this project, with the reason (see README "Licence").
const REVIEWED = new Map([
  ['OFL-1.1', 'font files only; SIL OFL 1.1 lets fonts be bundled with software under any licence; fonts stay OFL'],
]);

const out = execSync('npm ls --omit=dev --all --parseable', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const dirs = [...new Set(out.split(/\r?\n/).filter(Boolean))];
const counts = new Map();
const review = [];
const reviewed = [];
for (const dir of dirs) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    continue;
  }
  if (pkg.private) continue; // this repository's own workspaces
  let license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  if (!license && Array.isArray(pkg.licenses)) license = pkg.licenses.map((l) => l.type).join(' OR ');
  license ||= 'UNKNOWN';
  counts.set(license, (counts.get(license) ?? 0) + 1);
  // An SPDX expression is acceptable when every alternative of an OR, or every term of an AND, is permissive.
  const terms = license.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  const isOr = /\sOR\s/.test(license) && !/\sAND\s/.test(license);
  const ok = isOr ? terms.some((t) => PERMISSIVE.has(t)) : terms.every((t) => PERMISSIVE.has(t));
  if (ok) continue;
  if (REVIEWED.has(license)) reviewed.push(`${pkg.name}@${pkg.version}: ${license} (${REVIEWED.get(license)})`);
  else review.push(`${pkg.name}@${pkg.version}: ${license}`);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);
console.log(`Production packages (excluding this repo's private workspaces): ${total}`);
for (const [license, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${license}: ${n}`);
if (reviewed.length) {
  console.log('\nNot in the permissive allow-list, reviewed and accepted:');
  for (const line of reviewed) console.log(`  ${line}`);
}
if (review.length) {
  console.log('\nNeeds review (not in the permissive allow-list):');
  for (const line of review) console.log(`  ${line}`);
  process.exitCode = 1;
}
