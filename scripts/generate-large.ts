// Generates a realistically large roadmap bundle for performance testing.
// Run: npm run gen:large -- 600   → examples/large-test.waymark.json (import it from the app menu)

import { writeFileSync } from 'node:fs';
import type { Bundle } from '../src/shared/bundle';
import type { Checkpoint } from '../src/shared/model';

const target = Number(process.argv[2] ?? 600);
const statuses = ['not-started', 'not-started', 'in-progress', 'needs-review', 'complete', 'complete'];
const words = 'plan design study review build test measure refine explore compare document deploy analyse model draft outline'.split(' ');
const nouns = 'foundations interfaces storage networking testing tooling performance security patterns data models workflows deployment monitoring'.split(' ');
let n = 0;
const cps: Checkpoint[] = [];
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)]!;

function add(parent: string | null, depth: number, order: number) {
  if (n >= target) return;
  const id = `cp-lg${String(n).padStart(6, '0')}`;
  n++;
  const w = pick(words);
  const title = `${w[0]!.toUpperCase()}${w.slice(1)} ${pick(nouns)} ${n}`;
  cps.push({
    id,
    title,
    parent,
    order,
    summary: `Generated checkpoint ${n} at depth ${depth}.`,
    status: pick(statuses),
    understanding: null,
    approved: rand() > 0.5,
    optional: rand() > 0.93,
    archived: false,
    agentAccess: null,
    prerequisites: cps.length > 3 && rand() > 0.85 ? [cps[Math.floor(rand() * (cps.length - 1))]!.id] : [],
    completion: '',
    resources: [],
    sections: { content: `Content for ${title}.\n\n- point one\n- point two`, ...(rand() > 0.7 ? { notes: 'Some notes.' } : {}) },
    rev: 0,
  });
  const kids = depth === 0 ? 5 + Math.floor(rand() * 4) : depth < 3 ? Math.floor(rand() * 6) : 0;
  for (let i = 0; i < kids; i++) add(id, depth + 1, i + 1);
}

for (let i = 0; n < target; i++) add(null, 0, i + 1);

const bundle: Bundle = {
  format: 'waymark-bundle',
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  generator: 'waymark',
  roadmap: { id: 'rm-largetst', title: `Large test roadmap (${n})`, profile: 'general', description: 'Generated for performance testing.', agentAccess: 'review', created: new Date().toISOString(), overview: '' },
  checkpoints: cps,
  layout: { schema: 'waymark-layout/1', offsets: {} },
};
writeFileSync('examples/large-test.waymark.json', JSON.stringify(bundle));
console.log(`Wrote examples/large-test.waymark.json with ${n} checkpoints`);
