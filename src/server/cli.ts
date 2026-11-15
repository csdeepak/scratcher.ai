// Read-only checker for a workspace, usable without the app running (e.g. by an agent after editing).
//   npm run validate                       → checks ./workspace
//   npm run validate -- "D:/My Roadmaps"   → checks another folder
// Exit code 1 when problems are found.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { parseCheckpoint, parseRoadmapFile } from '../shared/checkpointFile';
import { getProfile } from '../shared/profiles';
import { parseChangeset } from '../shared/ops';
import { createsCycle } from '../shared/tree';
import type { Checkpoint } from '../shared/model';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== 'validate');
const root = path.resolve(args[0] ?? process.env.WAYMARK_WORKSPACE ?? path.join(here, '..', '..', 'workspace'));
const roadmapsDir = path.join(root, 'roadmaps');
let problems = 0;
let warnings = 0;
const err = (file: string, msg: string) => {
  problems++;
  console.log(`  ✗ ${file}: ${msg}`);
};
const warn = (file: string, msg: string) => {
  warnings++;
  console.log(`  ! ${file}: ${msg}`);
};

if (!existsSync(roadmapsDir)) {
  console.error(`No roadmaps folder in ${root}`);
  process.exit(1);
}

const rmIds = new Map<string, string>();
for (const slug of readdirSync(roadmapsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)) {
  const dir = path.join(roadmapsDir, slug);
  const rel = (f: string) => `roadmaps/${slug}/${f}`;
  console.log(`\n${slug}`);
  const metaPath = path.join(dir, 'roadmap.md');
  if (!existsSync(metaPath)) {
    err(rel('roadmap.md'), 'missing');
    continue;
  }
  const meta = parseRoadmapFile(readFileSync(metaPath, 'utf8'), slug);
  if (!meta.ok) {
    err(rel('roadmap.md'), meta.error);
    continue;
  }
  if (rmIds.has(meta.value.id)) err(rel('roadmap.md'), `roadmap id ${meta.value.id} is also used by ${rmIds.get(meta.value.id)}`);
  rmIds.set(meta.value.id, slug);
  const profile = getProfile(meta.value.profile);
  const cps: Record<string, Checkpoint> = {};
  const fileOf: Record<string, string> = {};
  const cpDir = path.join(dir, 'checkpoints');
  const files = existsSync(cpDir) ? readdirSync(cpDir).filter((f) => f.endsWith('.md') && !f.startsWith('.')) : [];
  for (const f of files) {
    const p = parseCheckpoint(readFileSync(path.join(cpDir, f), 'utf8'), profile, f);
    if (!p.ok) {
      err(rel(`checkpoints/${f}`), p.error);
      continue;
    }
    for (const w of p.warnings) warn(rel(`checkpoints/${f}`), w);
    const cp = p.value.checkpoint;
    if (p.value.missingId) {
      warn(rel(`checkpoints/${f}`), 'no id yet (the app will assign one)');
      continue;
    }
    if (cps[cp.id]) err(rel(`checkpoints/${f}`), `duplicate id ${cp.id} (also in ${fileOf[cp.id]})`);
    cps[cp.id] = cp;
    fileOf[cp.id] = `checkpoints/${f}`;
    if (!profile.statuses.some((s) => s.key === cp.status)) warn(rel(`checkpoints/${f}`), `status "${cp.status}" is not one of ${profile.statuses.map((s) => s.key).join(', ')}`);
  }
  for (const cp of Object.values(cps)) {
    if (cp.parent && !cps[cp.parent]) err(rel(fileOf[cp.id]!), `parent ${cp.parent} does not exist`);
    else if (cp.parent && createsCycle(cps, cp.id, cp.parent)) err(rel(fileOf[cp.id]!), 'parent chain loops back to itself');
    for (const pr of cp.prerequisites) if (!cps[pr]) warn(rel(fileOf[cp.id]!), `prerequisite ${pr} does not exist`);
  }
  const propDir = path.join(dir, 'proposals');
  if (existsSync(propDir)) {
    for (const f of readdirSync(propDir).filter((n) => /\.(ya?ml|json)$/i.test(n))) {
      try {
        const cs = parseChangeset(parseYaml(readFileSync(path.join(propDir, f), 'utf8')));
        if (!cs.ok) err(rel(`proposals/${f}`), cs.error);
        else for (const i of cs.value.invalid) err(rel(`proposals/${f}`), `change #${i.index + 1}: ${i.message}`);
      } catch (e) {
        err(rel(`proposals/${f}`), `not valid YAML/JSON: ${(e as Error).message.split('\n')[0]}`);
      }
    }
  }
  console.log(`  ${Object.keys(cps).length} checkpoints checked`);
}

console.log(`\n${problems ? `${problems} problem(s)` : 'No problems'}${warnings ? `, ${warnings} warning(s)` : ''} in ${root}`);
process.exit(problems ? 1 : 0);
