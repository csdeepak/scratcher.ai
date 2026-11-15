// Builds the sample roadmap and starter templates in ./examples from readable source.
// Run: npx tsx scripts/build-examples.ts

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Bundle } from '../src/shared/bundle';
import type { Checkpoint } from '../src/shared/model';

const out = path.resolve('examples');
mkdirSync(path.join(out, 'templates'), { recursive: true });
const now = '2026-11-15T09:00:00.000Z';

type CP = Partial<Checkpoint> & { id: string; title: string };
const cp = (c: CP): Checkpoint => ({
  parent: null,
  order: 1,
  summary: '',
  status: 'not-started',
  understanding: 'not-yet',
  approved: false,
  optional: false,
  archived: false,
  agentAccess: null,
  prerequisites: [],
  completion: '',
  resources: [],
  sections: {},
  rev: 0,
  updated: now,
  ...c,
});

const PRO_GIT = 'https://git-scm.com/book/en/v2';

const git: Checkpoint[] = [
  cp({
    id: 'cp-gitwhy001',
    title: 'Why version control',
    order: 1,
    summary: 'What problem Git solves and the mental model of snapshots.',
    status: 'complete',
    understanding: 'can-explain',
    approved: true,
    completion: 'Explain to a friend why "final_v2_really_final.doc" is a version-control problem.',
    resources: [{ title: 'Pro Git: About version control', url: `${PRO_GIT}/Getting-Started-About-Version-Control`, kind: 'book' }],
    sections: {
      objectives: '- Describe what a repository, a commit and a snapshot are.\n- Contrast centralised and distributed version control.',
      content:
        'Git records **snapshots** of a project over time. Each snapshot (a *commit*) knows its parent, so history forms a chain you can inspect, compare and return to.\n\nBecause every clone holds the full history, Git is *distributed*: you can commit offline and share later.',
      known: 'I have used Google Docs version history, which is similar for single files.',
      notes: 'The key shift for me: Git stores **snapshots**, not lists of edits.\n\n- [x] Read the Pro Git intro\n- [x] Watch one overview video',
      takeaways: '- A commit = snapshot + message + parent pointer.\n- Every clone is a full backup.',
      ownWords: 'Git is a time machine for a folder: I take labelled photos of the whole folder and can go back to any photo.',
    },
  }),
  cp({
    id: 'cp-gitsetup1',
    title: 'Install and configure Git',
    order: 2,
    summary: 'Install Git and set your identity and editor.',
    status: 'complete',
    understanding: 'can-apply',
    approved: true,
    resources: [{ title: 'Pro Git: First-time setup', url: `${PRO_GIT}/Getting-Started-First-Time-Git-Setup`, kind: 'book' }],
    sections: {
      content: '```bash\ngit config --global user.name "Your Name"\ngit config --global user.email "you@example.com"\ngit config --global init.defaultBranch main\n```',
      evidence: 'Ran `git config --list` and saw my name and email.',
    },
  }),
  cp({
    id: 'cp-gitcommit',
    title: 'Commits and history',
    order: 3,
    summary: 'Record changes deliberately and read the history.',
    status: 'learning',
    approved: true,
    prerequisites: ['cp-gitsetup1'],
    completion: 'Make five meaningful commits in a practice repo and find any change with `git log -p`.',
    sections: {
      objectives: '- Use the staging area to build focused commits.\n- Read history with `log` and `diff`.\n- Undo mistakes without losing work.',
      content: 'A commit is built in two steps: **stage** what you want (`git add`), then **commit** it with a message. Small, focused commits make history readable.',
      notes: 'Still confusing: when is `git restore` vs `git reset` the right tool?',
      questions: '- What happens to staged changes if I switch branches?',
    },
  }),
  cp({
    id: 'cp-gitstage1',
    title: 'The staging area',
    parent: 'cp-gitcommit',
    order: 1,
    summary: 'Choose exactly what goes into the next commit.',
    status: 'complete',
    understanding: 'can-explain',
    approved: true,
    resources: [{ title: 'Pro Git: Recording changes', url: `${PRO_GIT}/Git-Basics-Recording-Changes-to-the-Repository`, kind: 'book' }],
    sections: {
      content: 'Files move between three areas: **working tree → staging area (index) → repository**.\n\n```bash\ngit status        # what changed\ngit add file.txt  # stage one file\ngit add -p        # stage hunk by hunk\ngit commit -m "Explain why, not what"\n```',
      ownWords: 'Staging is a shopping basket: I put in only what belongs in this commit, then pay (commit).',
      takeaways: '- `git add -p` is the best habit for focused commits.',
    },
  }),
  cp({
    id: 'cp-gitlog001',
    title: 'Reading history: log and diff',
    parent: 'cp-gitcommit',
    order: 2,
    summary: 'Find when and why something changed.',
    status: 'learning',
    approved: false,
    resources: [{ title: 'Pro Git: Viewing the commit history', url: `${PRO_GIT}/Git-Basics-Viewing-the-Commit-History`, kind: 'book' }],
    sections: {
      content: '```bash\ngit log --oneline --graph --all\ngit log -p -- path/to/file\ngit diff            # unstaged changes\ngit diff --staged   # what will be committed\n```',
      practice: '1. In a practice repo, make three commits to one file.\n2. Use `git log -p` to find the commit that introduced a specific line.',
    },
  }),
  cp({
    id: 'cp-gitundo01',
    title: 'Undoing changes safely',
    parent: 'cp-gitcommit',
    order: 3,
    summary: 'Discard, unstage, amend and revert without losing work.',
    prerequisites: ['cp-gitlog001'],
    resources: [{ title: 'Pro Git: Undoing things', url: `${PRO_GIT}/Git-Basics-Undoing-Things`, kind: 'book' }],
    sections: {
      content: '| Situation | Command |\n|---|---|\n| Discard unstaged edits | `git restore file` |\n| Unstage | `git restore --staged file` |\n| Fix last commit message | `git commit --amend` |\n| Undo a pushed commit | `git revert <sha>` |',
    },
  }),
  cp({
    id: 'cp-gitbranch',
    title: 'Branching and merging',
    order: 4,
    summary: 'Work on parallel lines of development and combine them.',
    prerequisites: ['cp-gitcommit'],
    completion: 'Create two branches with conflicting edits, merge them, and resolve the conflict unaided.',
    resources: [
      { title: 'Pro Git: Basic branching and merging', url: `${PRO_GIT}/Git-Branching-Basic-Branching-and-Merging`, kind: 'book' },
      { title: 'Learn Git Branching (interactive)', url: 'https://learngitbranching.js.org/', kind: 'course' },
      { title: 'Example video (replace with one you like)', url: 'https://example.com/videos/git-branching', kind: 'video', start: '4:10', note: 'The diagram at 4:10 shows how HEAD moves.' },
    ],
    sections: {
      content: 'A branch is just a movable pointer to a commit. `HEAD` points at the branch you are on.',
    },
  }),
  cp({ id: 'cp-gitbrnew1', title: 'Create and switch branches', parent: 'cp-gitbranch', order: 1, summary: '`git switch -c`, `git branch`, and what HEAD means.' }),
  cp({ id: 'cp-gitmerge1', title: 'Merge and resolve conflicts', parent: 'cp-gitbranch', order: 2, summary: 'Fast-forward vs. merge commits; reading conflict markers.', prerequisites: ['cp-gitbrnew1'] }),
  cp({
    id: 'cp-gitrebas1',
    title: 'Rebase',
    parent: 'cp-gitbranch',
    order: 3,
    optional: true,
    summary: 'An alternative to merging that rewrites history. Useful, but optional for now.',
    prerequisites: ['cp-gitmerge1'],
    resources: [{ title: 'Pro Git: Rebasing', url: `${PRO_GIT}/Git-Branching-Rebasing`, kind: 'book' }],
  }),
  cp({
    id: 'cp-gitremot1',
    title: 'Working with remotes',
    order: 5,
    summary: 'Share work through a hosted repository.',
    prerequisites: ['cp-gitbranch'],
    resources: [{ title: 'Pro Git: Working with remotes', url: `${PRO_GIT}/Git-Basics-Working-with-Remotes`, kind: 'book' }],
  }),
  cp({ id: 'cp-gitpush01', title: 'Clone, fetch, pull and push', parent: 'cp-gitremot1', order: 1, summary: 'Keep a local copy in sync with a remote.' }),
  cp({
    id: 'cp-gitpr0001',
    title: 'Pull requests and code review',
    parent: 'cp-gitremot1',
    order: 2,
    summary: 'Propose changes and respond to review.',
    prerequisites: ['cp-gitpush01'],
    resources: [{ title: 'GitHub Docs: Pull requests', url: 'https://docs.github.com/en/pull-requests', kind: 'docs' }],
  }),
  cp({
    id: 'cp-gitcapst1',
    title: 'Capstone: contribute to a project',
    order: 6,
    summary: 'Use the whole workflow on a real repository.',
    prerequisites: ['cp-gitremot1', 'cp-gitundo01'],
    completion: 'A merged pull request to any repository (your own counts) that went through at least one review round.',
  }),
];

const gitBundle: Bundle = {
  format: 'waymark-bundle',
  schemaVersion: 1,
  exportedAt: now,
  generator: 'waymark',
  roadmap: {
    id: 'rm-example1',
    title: 'Example: Learn Git fundamentals',
    profile: 'learning',
    description: 'A small sample roadmap that shows every feature. Explore, edit or delete it.',
    agentAccess: 'review',
    created: now,
    overview:
      '## Goal\nBe comfortable using Git day to day: commit deliberately, branch and merge, and collaborate through pull requests.\n\n## Context for agents\nThe learner can use a terminal and has written small programs. Keep explanations practical with runnable commands.\n\n## What this sample shows\n- Main path down the left, sub-checkpoints to the right\n- Prerequisites (dashed arrows) and an **optional** branch (Rebase)\n- Approved vs. draft content, statuses, and the understanding check\n- Notes with checklists and code, resources with a video timestamp',
  },
  checkpoints: git,
  layout: { schema: 'waymark-layout/1', offsets: {} },
};

writeFileSync(path.join(out, 'learn-git.waymark.json'), JSON.stringify(gitBundle, null, 2));

// ---- generic starter templates (structure only) ----

const tpl = (title: string, profile: 'general' | 'learning', description: string, overview: string, items: [string, string, string?][]): Bundle => ({
  format: 'waymark-template',
  schemaVersion: 1,
  exportedAt: now,
  generator: 'waymark',
  roadmap: { id: 'rm-template', title, profile, description, agentAccess: 'review', created: now, overview },
  checkpoints: items.map(([id, t, parent], i) =>
    cp({ id, title: t, parent: parent ?? null, order: i + 1, understanding: profile === 'learning' ? 'not-yet' : null }),
  ),
  layout: { schema: 'waymark-layout/1', offsets: {} },
});

writeFileSync(
  path.join(out, 'templates', 'project.json'),
  JSON.stringify(
    tpl('Project', 'general', 'Plan → build → ship → reflect.', '## Goal\n\n## Constraints\n\n## Definition of done\n', [
      ['cp-tplproj01', 'Define the goal and scope'],
      ['cp-tplproj02', 'Plan the first version'],
      ['cp-tplproj03', 'Build'],
      ['cp-tplproj04', 'Test and polish'],
      ['cp-tplproj05', 'Ship'],
      ['cp-tplproj06', 'Reflect and decide next steps'],
    ]),
    null,
    2,
  ),
);

writeFileSync(
  path.join(out, 'templates', 'learning-topic.json'),
  JSON.stringify(
    tpl('Learning a topic', 'learning', 'Orient → foundations → practice → apply → teach back.', '## What I want to be able to do\n\n## Where I am now\n\n## Time and constraints\n', [
      ['cp-tpllrn001', 'Orientation: map the topic'],
      ['cp-tpllrn002', 'Foundations'],
      ['cp-tpllrn003', 'Core skills'],
      ['cp-tpllrn004', 'Practice project'],
      ['cp-tpllrn005', 'Teach it back'],
    ]),
    null,
    2,
  ),
);

console.log('Examples written to', out);
