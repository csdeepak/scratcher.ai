// Instructions written into the workspace for any AI agent that edits it.
// Bump AGENTS_VERSION_MARK when the text changes; untouched older copies are upgraded.

export const AGENTS_VERSION_MARK = '<!-- waymark:agents v4 -->';

export const CLAUDE_MD = `# Claude instructions for this folder

This folder is a Waymark workspace. Read and follow AGENTS.md before editing anything.

@AGENTS.md
`;

/** Gemini CLI reads GEMINI.md and loads files named with @ (its "memory import" syntax). */
export const GEMINI_MD = `# Gemini instructions for this folder

This folder is a Waymark workspace. Read and follow AGENTS.md before editing anything.

@./AGENTS.md
`;

export const AGENTS_MD = `${AGENTS_VERSION_MARK}
# Working in this Waymark workspace (instructions for AI agents)

This folder holds the human's **roadmaps**: maps of checkpoints with a notebook page for each.
The Waymark app watches these files and shows your edits live. **You draft and organise. The human
reviews, edits and decides.** Your edits never count as the human learning or finishing anything.

## Layout

\`\`\`
LIBRARY.md                            GENERATED list of every folder and roadmap with ids and paths. Never edit it.
roadmaps/                             the library. Folders group roadmaps (up to 4 levels, e.g. "Learning/Semester 5").
                                      A folder that contains roadmap.md is a roadmap; any other folder is a group.
<roadmap>/roadmap.md                  settings (front matter) + overview/goal (body)
<roadmap>/INDEX.md                    GENERATED outline: ids, status, files, problems. Read it first. Never edit it.
<roadmap>/checkpoints/*.md            one file per checkpoint (the file name doesn't matter; the id does)
<roadmap>/proposals/                  write changesets here for moves, deletions and big reorganisations
<roadmap>/layout.json                 map positions and the human's sticky notes (read if useful; leave alone)
templates/  backups/  .waymark/       app data: don't edit
\`\`\`

\`<roadmap>\` means the roadmap's folder, e.g. \`roadmaps/Learning/ai-syllabus\`. Find roadmaps in LIBRARY.md.

## Start every task like this

1. Find the roadmap in \`LIBRARY.md\`, then read its \`INDEX.md\`. It lists every checkpoint with its id, status and file, plus
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
| \`# What I already know\` | human; you may **add** below what is there |
| \`# What I need to learn\` | you or human |
| \`# Practice\` | you: exercises, activities, small builds |
| \`# My notes\` | human; you may **add** session notes below what is there |
| \`# Key takeaways\` | human; you may **add** new bullets below what is there |
| \`# In my own words\` | **human only** |
| \`# Evidence\` | **human only** |
| \`# Open questions\` | you or human |

## Rules the app enforces

- **Adding is allowed, rewriting is not.** In My notes, Key takeaways and What I already know you may add
  text *below* what is already there; the app applies it and lists it in Review. Changing, reordering or
  deleting the human's existing text there is **held**: the app puts the file back and asks the human.
- **Human-only:** status, understanding, approved, archived, agentAccess, In my own words, Evidence. Your
  edits to them are **held** for one-click approval. Don't retry; tell the human what you proposed.
- **Approved checkpoints** (\`approved: true\`) and sections with \`agentAccess: locked\`: content edits are held.
- **\`agentAccess: direct\`** on a checkpoint means your edits in it and below it apply without review.
  Otherwise your edits apply immediately but show up in the human's Review list to keep or revert.
- **Stale edits:** if \`rev\` in your write is lower than the current one, the human edited the file after you
  read it. Your changes to fields they also changed are held as conflicts. Always re-read before editing.
- **Deleting a checkpoint file** that has the human's notes, progress, approval or sub-checkpoints is held
  and the file comes back. Use a proposal instead (below).
- **Broken files** (bad YAML, missing \`---\`) are reported in INDEX.md and left untouched until fixed.

## Workflows

The human studies, works or brainstorms with you in a chat, then asks you to put the results into their
roadmap. Recognise these requests even when they are phrased loosely ("save this", "update my roadmap",
"wrap up"). If you can't write files in this chat, say so and use **No file access** below.

### Start a study or work session
Read the checkpoint file, its parent, and its INDEX.md entry first. Look at What I already know, What I
need to learn, Open questions, My notes and attachments, so you start from where the human is. Teach or
work in the chat; write nothing until the human asks you to wrap up (or asks for a specific edit).

### Wrap up a session ("record this", "update my notes")
1. Re-read the checkpoint file right before writing: the human may have edited it.
2. **Session notes go into \`# My notes\`**, added *below* the existing text, never replacing it. Start with
   a heading: \`### Session YYYY-MM-DD: <topic>\`.
   - **The human decides the format.** If they say how ("bullet points", "Q&A", "Cornell style", "only
     formulas", "short", "with code"), follow it exactly. A format they asked for earlier in the chat counts.
   - **If they didn't say, choose the clearest representation** for what happened:
     explaining a concept: key ideas as bullets, then one worked example, then formulas or code blocks.
     Solving problems: the steps, the mistake made and the fix.
     Brainstorming: ideas grouped by theme, then decisions, then next actions.
     Lots of questions: question and answer pairs.
     Keep it short: what the human will want to reread, not a transcript.
3. Add durable insights to \`# Key takeaways\` as new bullets (skip any that are already there).
4. Add unresolved points to \`# Open questions\`; tick (\`- [x]\`) any questions answered in this session.
5. Add resources you actually discussed to \`resources\` (real URLs only). Add new subtopics that deserve
   their own page as sub-checkpoints (new files with \`parent\`).
6. **Progress is the human's call.** Only if they said so ("I finished this", "I can explain it now"), set
   \`status\` or \`understanding\` accordingly: the app holds it until they approve it in Review. Never set
   them because you explained something.
7. Reply with the files you changed and what to check in Review.

### Brainstorm into the roadmap
Capture the outcome as session notes (as above) in the most related checkpoint. Turn concrete new
topics into new checkpoints under the right parent. For moving or deleting existing checkpoints, write a
proposal (see Common tasks).

### Check understanding ("quiz me")
Ask questions in the chat. On wrap-up, record a session note: what was asked, what went well, gaps. Put
gaps in Open questions. You may *suggest* an understanding level in the chat; set it only if the human
asks.

### No human in the loop
Running on a schedule, or told to "update everything" without details: choose the best representation
yourself, keep entries short, prefer adding over editing, and never touch status or understanding.

### No file access (web chat, or a file uploaded as a copy)
You can't change the files. Reply with a \`waymark-changeset/1\` YAML block (see Common tasks). Put session
notes and new takeaways in an \`update\` with \`append\`, which adds below the existing text so you never
retype it: \`append: { notes: "### Session …", takeaways: "- …" }\`. The human pastes the reply into
Waymark → Review → Paste proposal and previews it before anything changes.

## Attachments and links

- Images and PDFs for a checkpoint live in \`<roadmap>/attachments/<checkpoint-id>/\`. You may read them,
  and add files there (e.g. a diagram you made). Never delete or rename them.
- Embed an image in any section: \`![caption](../attachments/<checkpoint-id>/file.png)\`.
  Link a PDF: \`[Lecture slides](../attachments/<checkpoint-id>/slides.pdf)\`. Paths are relative to the
  checkpoint file, so they also work in Obsidian or VS Code.
- Link another checkpoint by its id: \`[Gradient descent](cp-k3x9a2mf)\`. Web links: normal Markdown links.
- Maths: LaTeX with \`$…$\` inline and a \`$$\` block on its own lines for display equations, e.g.
  \`$\\nabla f(x) = 0$\`. Write \`\\$\` for a literal dollar sign. The app renders it with KaTeX.

## Common tasks

**Organise roadmaps into folders.** Folders are ordinary folders under \`roadmaps/\`. Create one when the
human asks (e.g. \`roadmaps/Learning/\`). Moving a whole roadmap folder into another folder is safe: the app
follows it. Never move checkpoint files between roadmaps. Folder names must work on Windows and macOS:
no \`< > : " / \\ | ? *\`, no leading dot, no trailing dot or space.

**Draft a new roadmap.** Create \`roadmaps/<folder>/<slug>/roadmap.md\` (or \`roadmaps/<slug>/\` for the top level):

\`\`\`markdown
---
schema: waymark/1
id: rm-<8 random [a-z0-9]>
title: Learn X
profile: learning        # or general
description: One line.
agentAccess: review
color: blue              # optional tab colour: yellow orange red pink purple blue teal green gray
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
    append:                 # optional: add below a section's existing text (session notes, takeaways)
      notes: |
        ### Session 2026-11-16: eigenvectors
        - …
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
