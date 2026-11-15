// Instructions written into the workspace for any AI agent that edits it.
// Bump AGENTS_VERSION_MARK when the text changes; untouched older copies are upgraded.

export const AGENTS_VERSION_MARK = '<!-- waymark:agents v1 -->';

export const CLAUDE_MD = `# Claude instructions for this folder

This folder is a Waymark workspace. Read and follow AGENTS.md before editing anything.

@AGENTS.md
`;

export const AGENTS_MD = `${AGENTS_VERSION_MARK}
# Working in this Waymark workspace (instructions for AI agents)

This folder holds the human's **roadmaps**: maps of checkpoints with a notebook page for each.
The Waymark app watches these files and shows your edits live. **You draft and organise. The human
reviews, edits and decides.** Your edits never count as the human learning or finishing anything.

## Layout

\`\`\`
roadmaps/<roadmap>/roadmap.md         settings (front matter) + overview/goal (body)
roadmaps/<roadmap>/INDEX.md           GENERATED outline: ids, status, files, problems. Read it first. Never edit it.
roadmaps/<roadmap>/checkpoints/*.md   one file per checkpoint (the file name doesn't matter; the id does)
roadmaps/<roadmap>/proposals/         write changesets here for moves, deletions and big reorganisations
roadmaps/<roadmap>/layout.json        optional manual position offsets (usually leave alone)
templates/  backups/  .waymark/       app data: don't edit
\`\`\`

## Start every task like this

1. Read \`roadmaps/<roadmap>/INDEX.md\`. It lists every checkpoint with its id, status and file, plus
   **Needs attention** (broken files, changes that were held, proposals waiting).
2. Read \`roadmap.md\` for the goal, and the checkpoint files you'll touch. Read them fresh: the human may
   have edited them since you last looked.
3. Make focused edits: change only what the task needs. Leave unrelated checkpoints alone.
4. Re-read INDEX.md afterwards. If something you wrote shows under **Needs attention**, fix it or tell
   the human.

## Checkpoint file format

\`\`\`markdown
---
id: cp-k3x9a2mf          # stable identity. NEVER change it. New checkpoints: "cp-" + 8 random [a-z0-9]
title: Branching and merging
parent: cp-a81bz0qq       # parent's id; omit for a main (top-level) checkpoint
order: 2                  # position among siblings; decimals are fine (2.5 goes between 2 and 3)
summary: One or two sentences: what this is and why it matters.
status: not-started       # HUMAN ONLY
understanding: not-yet    # HUMAN ONLY (learning roadmaps)
approved: false           # HUMAN ONLY. true = the human approved the content; don't edit it
optional: false           # true for optional/alternative paths
prerequisites: [cp-q1w2e3r4]   # ids this checkpoint requires (other branches of the map)
completion: How to tell this checkpoint is done (optional).
resources:
  - title: Official guide, chapter 3
    url: https://example.org/guide/3
    kind: docs            # article | video | book | course | docs | tool | other
  - title: Talk on the topic
    url: https://example.org/video
    kind: video
    start: "12:30"        # optional timestamp
    note: Watch 12:30–20:00
rev: 7                    # version number: leave it exactly as you read it
---

# Content

The explanation. Use \`##\` and smaller headings inside a section. Never use a single \`#\`.

# My notes

(The human's. Read it to understand them, but don't change it.)
\`\`\`

Sections are top-level \`#\` headings with these exact names. Write only the sections listed in INDEX.md
for the roadmap's profile.

| Heading | Who writes it |
|---|---|
| \`# Objectives\` | you (learning) |
| \`# Content\` | you: explanation or main material |
| \`# What I already know\` | **human only** |
| \`# What I need to learn\` | you or human |
| \`# Practice\` | you: exercises, activities, small builds |
| \`# My notes\` | **human only** |
| \`# Key takeaways\` | **human only** |
| \`# In my own words\` | **human only** |
| \`# Evidence\` | **human only** |
| \`# Open questions\` | you or human |

## Rules the app enforces

- **Human-only fields and sections** (status, understanding, approved, archived, agentAccess, My notes,
  Key takeaways, What I already know, In my own words, Evidence): your edits to them are **held**. The
  app puts the file back and asks the human. Don't retry. Ask the human in chat if you think a change is needed.
- **Approved checkpoints** (\`approved: true\`) and sections with \`agentAccess: locked\`: content edits are held.
- **\`agentAccess: direct\`** on a checkpoint means your edits in it and below it apply without review.
  Otherwise your edits apply immediately but show up in the human's Review list to keep or revert.
- **Stale edits:** if \`rev\` in your write is lower than the current one, the human edited the file after you
  read it. Your changes to fields they also changed are held as conflicts. Always re-read before editing.
- **Deleting a checkpoint file** that has the human's notes, progress, approval or sub-checkpoints is held
  and the file comes back. Use a proposal instead (below).
- **Broken files** (bad YAML, missing \`---\`) are reported in INDEX.md and left untouched until fixed.

## Common tasks

**Draft a new roadmap.** Create \`roadmaps/<slug>/roadmap.md\`:

\`\`\`markdown
---
schema: waymark/1
id: rm-<8 random [a-z0-9]>
title: Learn X
profile: learning        # or general
description: One line.
agentAccess: review
created: 2026-01-01T00:00:00.000Z
rev: 0
---
Goal, scope and context in a few paragraphs.
\`\`\`

Then add \`checkpoints/<slug>.md\` files, first the 4–8 main checkpoints (no \`parent\`), and
sub-checkpoints only where asked. Don't plan every detail up front.

**Expand one checkpoint.** Add new files with \`parent: <its id>\` and \`order: 1, 2, 3…\`. Don't touch
other branches.

**Revise content.** Edit the sections you own and \`summary\`, \`completion\`, \`resources\`,
\`prerequisites\` and \`optional\`. Keep everything else byte-for-byte.

**Connect checkpoints.** Add the prerequisite's id to \`prerequisites\` on the checkpoint that needs it.

**Move, merge, delete or reorganise.** Write a proposal instead of editing many files:
\`roadmaps/<roadmap>/proposals/<short-name>.yaml\`

\`\`\`yaml
schema: waymark-changeset/1
title: Split "Basics" into two parts
author: claude
summary: Why you suggest this, in a sentence or two.
changes:
  - op: add                 # new checkpoint
    id: cp-n3wid001         # optional; pick a fresh id if later changes refer to it
    parent: cp-a81bz0qq     # omit or null for top level
    after: cp-q1w2e3r4      # optional: place after this sibling
    title: Working with remotes
    summary: …
    sections:
      content: |
        Markdown text…
    resources:
      - { title: Guide, url: "https://example.org", kind: docs }
  - op: update              # change fields; only the keys you list change
    id: cp-k3x9a2mf
    rev: 7                  # the rev you read (helps detect conflicts)
    set:
      title: New title
      summary: …
      sections: { content: "…" }
  - op: move
    id: cp-k3x9a2mf
    parent: cp-n3wid001     # null for top level
    after: null             # null = first; omit = last
  - op: delete              # goes to the human's Trash after approval
    id: cp-zzzzzzzz
  - op: link                # cp-k3x9a2mf requires cp-q1w2e3r4
    id: cp-k3x9a2mf
    prerequisite: cp-q1w2e3r4
  - op: unlink
    id: cp-k3x9a2mf
    prerequisite: cp-q1w2e3r4
\`\`\`

The human previews it in Waymark → Review and accepts or rejects each change.

## Checking your work

If the Waymark app is running, INDEX.md updates within a second and lists any problem. If it isn't, the
human can run \`npm run validate -- "<this folder>"\` in the Waymark app folder.

## Writing style

- Write for the human's level. The overview in roadmap.md and their notes tell you where they are.
- Keep \`summary\` short (1–2 sentences). Put depth in \`# Content\`.
- Prefer a few high-quality resources with real, working URLs. Never invent URLs or timestamps.
- When you finish, tell the human in chat what you changed and what they should review.
`;
