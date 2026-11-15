// "Copy for AI": a self-contained brief for agents that cannot access the files (e.g. a web chat).
// The agent replies with a YAML changeset, which the human pastes into Review to preview.

import type { Workspace } from './workspace';
import { renderIndex } from './indexFile';
import { getProfile } from '../shared/profiles';

export function buildBrief(ws: Workspace, roadmapId: string, checkpointId: string | null, request: string): string {
  const rm = ws.getRoadmap(roadmapId);
  const profile = getProfile(rm.meta.profile);
  const focus = checkpointId ? ws.subtreeIds(roadmapId, checkpointId) : [];
  const files = focus.map((id) => `<<<FILE ${rm.files[id] ?? id}\n${ws.checkpointText(roadmapId, id)}\n>>>`);
  const focusTitle = checkpointId ? rm.checkpoints[checkpointId]?.title : null;
  return [
    `You are helping me edit a roadmap in Waymark, a local roadmap notebook. I can't give you file access, so reply with a YAML *changeset* that I will paste into the app to preview and approve.`,
    '',
    `## My request`,
    request.trim() || (focusTitle ? `Expand and improve the checkpoint "${focusTitle}".` : 'Draft or improve this roadmap.'),
    '',
    `## Rules`,
    `- Change only what the request needs. Refer to existing checkpoints by their id (e.g. \`cp-k3x9a2mf\`).`,
    `- New checkpoints: give each an id "cp-" + 8 random lowercase letters/digits if other changes refer to it.`,
    `- Don't set status, understanding, approved, or these sections that belong to me: My notes, Key takeaways, What I already know, In my own words, Evidence.`,
    `- Sections you may write: ${profile.sections.filter((s) => !['notes', 'takeaways', 'known', 'ownWords', 'evidence'].includes(s)).join(', ')}. Markdown inside; use ## or smaller headings.`,
    `- Only real, working URLs for resources. Don't invent links or timestamps.`,
    `- Reply with ONE fenced \`\`\`yaml block containing the changeset, then a short plain-language summary.`,
    '',
    '## Changeset format',
    '```yaml',
    'schema: waymark-changeset/1',
    `roadmap: ${rm.meta.id}`,
    'title: Short title of the proposal',
    'author: chatgpt   # or your name',
    'summary: Why these changes.',
    'changes:',
    '  - op: add',
    '    id: cp-abc12345',
    '    parent: cp-PARENTID      # omit for top level',
    '    after: cp-SIBLINGID      # optional position',
    '    title: …',
    '    summary: …',
    '    optional: false',
    '    prerequisites: [cp-OTHERID]',
    '    sections:',
    '      content: |',
    '        Markdown…',
    '    resources:',
    '      - { title: …, url: "https://…", kind: video, start: "4:10" }',
    '  - op: update',
    '    id: cp-EXISTING',
    '    set: { summary: …, sections: { content: "…" } }',
    '  - op: move',
    '    id: cp-EXISTING',
    '    parent: cp-NEWPARENT     # null for top level',
    '  - op: delete',
    '    id: cp-EXISTING',
    '  - op: link                 # cp-A requires cp-B',
    '    id: cp-A',
    '    prerequisite: cp-B',
    '```',
    '',
    `## Roadmap: ${rm.meta.title}`,
    rm.meta.overview ? `\n${rm.meta.overview}\n` : '',
    '### Outline',
    renderIndex(rm, [], []).split('## Outline')[1]?.trim() ?? '',
    ...(files.length ? ['', `### Full text of "${focusTitle}" and everything under it`, ...files] : []),
  ].join('\n');
}
