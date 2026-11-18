# Waymark: the complete overview

*What it is, the problems it solves, who it is for, how people use it, how it works inside, and where it
fits in the market. Written November 2026, at version 0.1.1 (0.1.2 in preparation).*

---

## Contents

1. [In one paragraph](#1-in-one-paragraph)
2. [The pain points](#2-the-pain-points)
3. [The idea](#3-the-idea)
4. [Who it is for](#4-who-it-is-for)
5. [How people use it](#5-how-people-use-it)
6. [How it works: architecture](#6-how-it-works-architecture)
7. [How it works: the data](#7-how-it-works-the-data)
8. [How it works: the workspace engine](#8-how-it-works-the-workspace-engine)
9. [How it works: the app you see](#9-how-it-works-the-app-you-see)
10. [How it works: the desktop app](#10-how-it-works-the-desktop-app)
11. [How it works with AI agents](#11-how-it-works-with-ai-agents)
12. [Safety, privacy and reliability](#12-safety-privacy-and-reliability)
13. [Quality, accessibility and languages](#13-quality-accessibility-and-languages)
14. [Technology stack](#14-technology-stack)
15. [The market](#15-the-market)
16. [Status and what comes next](#16-status-and-what-comes-next)
17. [Glossary](#17-glossary)
18. [Sources](#18-sources)

---

## 1. In one paragraph

Waymark is a local-first **roadmap notebook**. A goal (learning machine learning, a semester's
subjects, a portfolio project) becomes a visual **map of checkpoints**, and each checkpoint opens into a
**notebook page**: explanation, your notes, key takeaways, open questions, resources, practice and
progress. Everything is stored as **plain Markdown files in one folder on your computer**. Any AI agent
that can edit files (Claude in the Code tab or Cowork, Codex in the ChatGPT desktop app, Cursor, Gemini
CLI and others) works in that same folder: it drafts roadmaps, explains topics and writes up your study
sessions, and Waymark shows its edits within a second. The human stays the **senior editor**: agents may
add to your notes but never rewrite them, progress is only ever set by you, and every agent change can
be reviewed, kept or reverted. There is no account, no subscription, no built-in AI and no AI API key:
you bring the AI you already use, and you keep the files.

---

## 2. The pain points

People now learn and plan with AI chat every day. The tools around that habit have gaps.

| Pain point | What it looks like | How Waymark answers it |
|---|---|---|
| **Knowledge evaporates in chat history** | A great explanation from Claude or ChatGPT is buried three weeks back in a chat list. Each new chat starts from zero. | Agents write session notes, takeaways and open questions into the checkpoint's page. The next session reads them first, so it starts where you left off. |
| **Generic roadmaps aren't yours** | Public roadmaps (roadmap.sh and similar) show *a* path, not *your* path: no room for your notes, your level, your syllabus, your pace. | Your roadmap is yours: any goal, any structure, with a full notebook behind every checkpoint. Public material becomes resources inside it. |
| **Notes apps have no path** | Notion, OneNote and Obsidian hold notes well, but a learning journey needs order, prerequisites and visible progress. | A map with a main path, sub-checkpoints, prerequisite arrows, optional branches and progress rolled up from the leaves. |
| **AI that can edit your files can also wreck them** | Give an agent file access and it may rewrite or delete what you wrote, or mark something as "learned" because it explained it. | Guard rules enforced by the app: your sections are append-only for agents, your fields (status, understanding, approval) are held for your OK, stale edits are merged without losing yours, deletions of your work are refused. |
| **Hallucinated progress** | "The AI explained it, so I've learned it." | Status and understanding are human-only. A learning checkpoint asks *can I explain it? can I apply it?*, and there are sections only you write: *In my own words* and *Evidence*. |
| **Lock-in and cost** | Proprietary formats, cloud accounts, AI add-on subscriptions, API keys with usage bills. | Plain Markdown and YAML in your folder, readable without the app. No AI is bundled; the AI subscription you already have does the work. Works offline. |
| **Everything is scattered** | The syllabus is a PDF, notes in a doc, links in bookmarks, lectures on YouTube, slides in Downloads, progress in your head. | One page per topic holds content, notes, resources, attached images, PDFs, video, audio and documents (with a built-in viewer), YouTube/Vimeo lectures that play in place from the right minute, maths and progress. |
| **Hard to restructure safely** | Reorganising a plan by hand or by AI loses things. | Agents propose moves and deletions as a *changeset* you preview change by change; everything has history, undo, trash and daily backups. |
| **Tools that only work for some people** | English-only file names, mouse-only maps, low-contrast text. | Folder and file names in any script, right-to-left text, full keyboard use, screen-reader names, WCAG AA contrast in both themes (see section 13). |

---

## 3. The idea

**Three roles, one folder.**

```
        you (senior editor)                  your AI agent (author)
   read · rewrite · approve · decide      draft · explain · organise · record
                 \                                   /
                  \                                 /
                   ▼                               ▼
          ┌──────────────────────────────────────────────┐
          │   the workspace folder (plain Markdown files) │  ← the single source of truth
          └──────────────────────────────────────────────┘
                                 ▲
                                 │ watches, protects, shows
                          Waymark (the app)
```

* **The folder is the database.** The app and every agent read and write the same files. If Waymark
  disappeared tomorrow, your notes would still be ordinary Markdown.
* **The agent is the author, the human is the editor.** Agents do the heavy drafting; you inspect,
  correct, approve, and alone decide what is complete or understood.
* **No built-in AI.** Waymark never calls a model. It integrates through files and a written contract
  (`AGENTS.md`) that any agent can follow.
* **Content-agnostic.** The tool has no built-in subjects. A syllabus, a project plan or a reading list
  is content you (or your agent) create inside it.

**Core concepts**

| Concept | Meaning |
|---|---|
| Workspace | The one folder that holds everything. Chosen on first start (desktop suggestion: `Documents\Waymark`). |
| Library | All roadmaps, grouped in folders up to four levels deep (e.g. *Learning / Semester 5*), with colour tabs. |
| Roadmap | One goal. Has a goal/context page and a map. |
| Checkpoint | A step on the map, with a notebook page. Main checkpoints form the *main path*; sub-checkpoints branch to the right. |
| Profile | *General* (content, notes, takeaways, questions) or *Learning* (adds objectives, what I know, what I need to learn, practice, in my own words, evidence, and an understanding check). |
| Status | General: not started, in progress, needs review, complete. Learning: not started, learning, practising, needs review, complete. Set only by you. |
| Understanding | Learning roadmaps: not yet, can explain, can apply. Set only by you. |
| Approval | Marks content as checked by you; approved content is protected from agent rewrites. |
| Prerequisite | A dashed arrow: "this needs that first". |
| Progress | Completed sub-checkpoints ÷ all sub-checkpoints below, at every level, ignoring optional and archived ones. A parent is never completed automatically. |
| Review | The inbox of agent changes: keep or revert, apply or discard held changes, preview proposals. |
| Proposal | A changeset file (`proposals/*.yaml`) for moves, deletions and big reorganisations, applied change by change after your preview. |

---

## 4. Who it is for

| Person | What they get |
|---|---|
| **University students** (e.g. engineering and computer-science students organising a semester) | One roadmap per subject in a *Semester* folder; lecture PDFs attached to the right topic; session notes from Claude or ChatGPT written into the right page; honest progress before exams. |
| **Self-learners and career switchers** (machine learning, web development, data analysis) | A personal path instead of a generic one; an AI tutor whose explanations are kept; "quiz me" sessions recorded with gaps turned into open questions. |
| **Developers learning a new stack** | Already work with Claude Code, Codex or Cursor; Waymark gives those agents a structured place to write learning material next to their code habits. |
| **Makers and researchers** | Project roadmaps (general profile) with notes, decisions and resources per milestone; proposals keep restructuring safe. |
| **Mentors and educators** | Build a roadmap once, save it as a *template* (structure without personal notes), share the `.waymark.json` or a PDF/web export. |
| **Privacy-conscious and offline users** | No account, no cloud, no telemetry; works on a plane. |
| **Users who need accessibility or other languages** | Keyboard-only use, screen-reader labels, high contrast in light and dark, reduced motion, right-to-left text, file names in their own script. |

---

## 5. How people use it

### First start (desktop app)

1. **Install** the Windows installer from GitHub Releases (per-user, no admin rights needed). The app
   updates itself afterwards.
2. **Welcome page, step 1: choose the workspace folder.** The suggested folder is pre-filled; type or
   browse to any other. The folder is checked as you type: *new* (will be created), *empty*, *already a
   Waymark workspace* (opened as it is), or *has other files* (allowed, with a warning and a one-click
   "new folder inside it"). Whole drives, the whole user folder, system folders and the app's own folder
   are refused. OneDrive/Dropbox folders get a "keep on this device" tip.
3. **Step 2: Connect your AI.** One card per tool, with the folder path and a first prompt to copy:
   Claude (Code tab recommended, Cowork, or chat with a file-access extension), ChatGPT (Codex in the
   desktop app; plain browser chat uses copy and paste), Cursor / VS Code / Windsurf, Gemini CLI.

The browser version (`npm start`, then `http://localhost:4317`) works the same without the welcome page.

### Building a roadmap

| Way | How |
|---|---|
| Ask your agent | "Read AGENTS.md, then create a roadmap for my goal: …". The checkpoints appear on the map as the agent writes them, marked *Draft*. |
| By hand | *New roadmap* → Learning or General, folder, colour; then add checkpoints on the map (A = sub-checkpoint, N = next, type the name in place). |
| From a template | Pick a saved structure when creating. |
| Import | A Markdown outline (headings and lists become checkpoints, e.g. a syllabus pasted from a chat), OPML from mind-map apps, a `.waymark.json` file or a `.waymark.zip` backup. |

### The study loop (the everyday use)

```
 pick a checkpoint ──► "Start a session" prompt ──► study in the chat ──► say "wrap up"
        ▲                                                                        │
        │                                                                        ▼
  set status / understanding ◄── keep or revert in Review ◄── agent writes session notes,
        (you only)                                              takeaways, questions, resources
```

1. Select a checkpoint. **⋯ → Work with an agent → Session prompts** copies a prompt that points the
   agent at the right file and workflow (start a session, wrap up, brainstorm, quiz me, expand into
   sub-checkpoints, draft a new roadmap). You can say how notes should look: bullets, Q&A, Cornell,
   "only formulas".
2. Study or brainstorm in the chat. Nothing is written until you say "wrap up".
3. The agent appends a dated session note to **My notes** (never replacing what is there), adds new
   takeaways and open questions, ticks answered questions, adds resources it actually used, and may add
   sub-checkpoints. If you said "I can explain this now", it *proposes* the understanding level.
4. The map and page update live. **Review** lists every agent change: keep or revert; proposed status
   changes wait for your one-click OK.

### Working on the map

* Drag to rearrange; drop a checkpoint onto another to move it under it; drag a checkpoint's blue dot to
  another to add a prerequisite; double-click to rename; right-click for menus.
* Select several (Shift+drag box, Ctrl+click), then move, set status or delete together.
* **F** focuses one branch, **O** returns to the overview; *Expand everything / Collapse*.
* Sticky notes on the map, anchored to the nearest checkpoint.
* Undo/redo for renames, moves, links, statuses, deletes, notes and positions; per-checkpoint history.
* Both toolbars can be customised (tick, reorder; everything else stays in the ⋯ menu).

### Writing on a page

Click into a section and type: a Google-Docs-style formatting bar appears (text style, bold, italic,
lists, link, Insert for image, table, code, maths, quote, divider). Paste a screenshot or drop a PDF, a
video, an audio recording or a document to attach it; a YouTube, Vimeo or Loom link on its own line
becomes a *Play* card that plays in the note, from the link's time; LaTeX maths (`$…$`, `$$…$$`) renders live; `[title](cp-…)` links jump between checkpoints.
It saves about 0.65 s after you stop typing and closes when you click elsewhere. `</>` shows the raw
Markdown.

### Sharing and keeping

Export a roadmap or one branch as PDF, a self-contained web page, Markdown, a map image (PNG), OPML, a
data file or a full backup, with or without personal notes. Daily backups are automatic. *Workspace
folder → Move my workspace here* moves everything to a new folder with every file checked.

---

## 6. How it works: architecture

```
┌───────────────────────── your computer ─────────────────────────────────────────────────┐
│                                                                                         │
│  AI agents (Claude Code / Cowork, Codex, Cursor, Gemini CLI …)                          │
│        │  read AGENTS.md, INDEX.md · edit checkpoint files · write proposals            │
│        ▼                                                                                │
│  ┌──────────────────────── workspace folder ────────────────────────┐                   │
│  │ AGENTS.md CLAUDE.md GEMINI.md LIBRARY.md                         │                   │
│  │ roadmaps/<folders>/<roadmap>/ roadmap.md INDEX.md layout.json    │                   │
│  │                               checkpoints/*.md attachments/ proposals/              │
│  │ templates/  backups/YYYY-MM-DD/*.waymark.zip  .waymark/(history, review, trash)     │
│  └───────────────▲──────────────────────────────────┬────────────────┘                  │
│                  │ atomic writes (temp → fsync → rename)  │ file events (chokidar)       │
│  ┌───────────────┴──────────────────────────────────▼────────────────┐                  │
│  │  Waymark server (Node, Hono) — the only writer                    │                  │
│  │  parse + validate (zod, yaml) → guard rules → three-way merge     │                  │
│  │  → history / review / trash → INDEX.md, LIBRARY.md, backups       │                  │
│  │  HTTP API on 127.0.0.1 · Server-Sent Events for live updates      │                  │
│  └───────────────▲──────────────────────────────────┬────────────────┘                  │
│                  │ JSON ops (same ops as proposals) │ SSE: "roadmap changed"             │
│  ┌───────────────┴──────────────────────────────────▼────────────────┐                  │
│  │  UI (React + Zustand): library · outline · map (React Flow) ·     │                  │
│  │  notebook pages (Milkdown) · review · palette · viewer            │                  │
│  └───────────────────────────────────────────────────────────────────┘                  │
│      in a browser tab (npm start) or in the Electron desktop window                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Key decisions and why**

| Decision | Why | Trade-off |
|---|---|---|
| Markdown files as the database | Humans and agents can read and edit them; they diff in git; nothing is lost if the app goes away. | Files must be parsed on every change, and free-form editing can break one. Broken files are detected, shown and never overwritten. |
| A small local server as the single writer | A browser page can't watch a folder or write files without repeated permission prompts. One writer means one place for guard rules. | One process to run (hidden inside the desktop app). |
| Shared code in `src/shared` | The same schema, parser, change operations, guard rules and progress maths run in the server, the browser and the tests. | Must stay environment-neutral. |
| Compose mature open-source parts, build only the new part | Map, editor, tree, UI primitives and file watching are proven components; the unique work is the agent-safe file model and review. | Integration work between components. |
| No built-in AI | No API keys, no bills, no vendor lock-in; works with whatever agent you prefer. | Users need an agent that can open a folder (or use copy and paste). |

---

## 7. How it works: the data

### Folder layout

```
<workspace>/
  AGENTS.md               rules and workflows for every agent (versioned; upgraded when untouched)
  CLAUDE.md, GEMINI.md    pointers that load AGENTS.md for Claude and Gemini CLI
  LIBRARY.md              generated: every folder and roadmap with ids and paths
  roadmaps/
    Learning/Semester 5/  folders group roadmaps (a folder with roadmap.md is a roadmap)
      ml/
        roadmap.md        settings (front matter) + goal and context (body)
        INDEX.md          generated outline: ids, status, files, problems, items needing attention
        layout.json       hand-moved positions and sticky notes
        checkpoints/*.md  one file per checkpoint
        attachments/<checkpoint-id>/   images, PDFs, documents (50 MB) and video/audio (500 MB)
        proposals/*.yaml  changesets waiting for review
  templates/*.json        reusable structures (no personal notes)
  backups/YYYY-MM-DD/     one .waymark.zip per roadmap per day, last 30 days
  .waymark/               app data: history/*.jsonl, review.json, trash/, archive/, broken/
```

### A checkpoint file

```markdown
---
id: cp-87fphoxr                 # identity; never changes (file names and positions don't matter)
title: "Linear and logistic regression"
parent: cp-pdcs3wii             # the tree comes from parent ids, not from folders
order: 1                        # position among siblings (decimals allowed)
summary: "The simplest models: a weighted sum of features…"
status: not-started             # human only
understanding: not-yet          # human only (learning profile)
approved: false                 # human only
optional: false
prerequisites: [cp-ztrgbm4c]    # dashed "requires" arrows
completion: "You can fit both in scikit-learn and read the weights."
resources:
  - { title: "scikit-learn: Linear models", url: https://scikit-learn.org/…, kind: docs }
  - { title: "A lecture", url: https://…, kind: video, start: "12:30" }
rev: 3                          # version counter used to detect stale edits
---

# Content
…explanation by the agent…

# My notes
…yours; agents may only add below…
```

Sections are top-level `#` headings with fixed names. Who may write what:

| Section | Writer |
|---|---|
| Objectives, Content, Practice | agent (you can edit) |
| What I need to learn, Open questions | agent or you |
| What I already know, My notes, Key takeaways | you; agents may only **add** below your text |
| In my own words, Evidence | you only |

### Names and identity

* Identity is always the `id` (`cp-` + 8 random characters). Files can be renamed or moved without
  breaking anything.
* New folder and file names come from titles and keep the letters of every script
  (`मशीन-लर्निंग`, `机器学习入门`, `تعلم-الآلة`); Latin accents are simplified; names Windows reserves
  (`con`, `nul`, `com1`…) get `-1`.

### Formats in and out

| Format | Use |
|---|---|
| `waymark-bundle` (`.waymark.json`) | Data-only export/import of one roadmap; versioned and migrated on import. |
| `.waymark.zip` | Full backup: the bundle plus every attachment; restoring always creates a new roadmap. |
| `waymark-changeset/1` | Proposals: `add`, `update` (with `set`, `append`, `rev`), `move`, `delete`, `link`, `unlink`. The app's own edits use the same operations. |
| Markdown outline, OPML | Import from chats, syllabi and mind-map apps; OPML export to mind-map apps. |
| PDF, HTML, Markdown, PNG | Exports for reading and sharing (personal notes optional). |

---

## 8. How it works: the workspace engine

The server-side engine (`src/server/workspace.ts` with `src/shared/*`) does the real work.

1. **Load.** On start it reads every roadmap and checkpoint, validates them (zod schemas, YAML front
   matter), builds the in-memory model and the generated `INDEX.md` / `LIBRARY.md`. State is rebuilt
   from the files every time.
2. **Your edits.** The UI sends small **operations** (rename, set a section, move, link…) about 0.65 s
   after you stop typing. Each `update` can carry an `expect` value (compare-and-set): if the section
   changed on disk while you were editing, you get *Keep mine / Use theirs / Compare* instead of a silent
   overwrite. Writes are atomic (temp file, fsync, rename) and retried around Windows antivirus file
   locks; the indicator says *Saved* only after the write is confirmed.
3. **Agent edits.** chokidar reports a changed file. The engine ignores its own writes (by content hash),
   parses the new file and compares it **field by field** with the last known version:

| What the agent changed | What happens |
|---|---|
| Shared content of an unapproved checkpoint | Applied live; listed in Review as *unreviewed* (keep or revert). With `agentAccess: direct`, no review. |
| Text added below yours in My notes / Takeaways / What I already know | Applied (a pure append is detected). |
| Your text changed, reordered or deleted; status, understanding, approval, archive, access level; *In my own words*, *Evidence* | **Held**: the file is put back and the change waits in Review (*Apply* / *Discard*). |
| Approved checkpoint, or a branch set to `locked` | Held. |
| A write based on an older `rev` | Three-way merge: fields you changed since win; the agent's conflicting values are held. |
| Deleting a file that holds your work or sub-checkpoints | Refused: the file comes back and the deletion waits in Review. Other deletions go to Trash. |
| A file that doesn't parse | The last good version stays in the app; the problem shows in the app and in `INDEX.md`; the file is never overwritten until fixed or restored. |
| A new checkpoint file | Added as *Draft*, not started; any human-only values in it are held. |

4. **Proposals.** Files in `proposals/` are parsed into a preview in Review; you accept or reject each
   change, and accepted ones run through the same operations engine.
5. **History, undo, trash.** Every change (yours, agents', imports, proposals, restores) is appended to
   `.waymark/history/<roadmap>.jsonl` with the full before/after text; any version can be restored.
   Deleted checkpoints and roadmaps go to `.waymark/trash/`. The UI keeps undo/redo stacks of operations
   with their inverses (the pattern of draw.io's undo manager and Excalidraw's history).
6. **Backups.** The first save each day writes a `.waymark.zip` per roadmap (fflate), keeping 30 days.
7. **Live updates.** The server pushes "this changed" events over Server-Sent Events; the page refetches
   what changed. If the server is unreachable, edits wait in a small browser outbox and are replayed.
8. **Local API.** `127.0.0.1` only; requests from other websites are refused by Origin and Host checks.
   Scripts can use the same API (documented in `DATA-FORMAT.md`).

---

## 9. How it works: the app you see

| Part | Built with | Notes |
|---|---|---|
| Layout | React 19, Tailwind CSS 4, IBM Plex Sans/Mono (bundled) | Library (left), outline, map (centre), details (right); drawers on small screens; light and dark themes from colour tokens. |
| State | Zustand | Roadmaps, selection, dialogs, review items, the offline outbox, toolbar layouts. |
| Map | React Flow 12 + d3-hierarchy (tidy tree) | Main path down a spine, sub-checkpoints to the right; manual offsets on top of the automatic layout; prerequisite arrows; minimap; only the visible nodes are drawn on maps with more than 150 checkpoints. |
| Outline | react-arborist | Virtualised tree with drag-and-drop, inline rename and keyboard navigation, kept in sync with the map. |
| Notebook pages | Milkdown Crepe (ProseMirror + remark) | WYSIWYG Markdown that round-trips agent formatting; lossy content opens in raw Markdown instead; a one-row customisable formatting bar. |
| Maths, PDFs | KaTeX; pdf.js | Rendered in pages, the editor and exports; offline viewer with zoom, search and working links. |
| Media | Browser `<video>`/`<audio>`; provider embed players; htmlparser2 | Attached video and audio stream with range requests; YouTube/Vimeo/Loom play behind a click-to-play card (nothing loads before play); resource titles from oEmbed or page tags. See [MEDIA.md](MEDIA.md). |
| Menus and dialogs | Radix UI, cmdk (Ctrl+K palette), sonner (toasts), lucide icons | Accessible primitives; focus returns to where you were when a dialog closes. |
| Keyboard model | Custom on top of React Flow | The map is one Tab stop; arrows move between checkpoints; Enter opens, Enter again renames; Tab/Shift+Tab indent the selected checkpoint (Escape then Tab leaves the map). |

---

## 10. How it works: the desktop app

* **Electron 45.** The window has no Node access (context isolation and sandbox). The same server runs
  in an Electron *utility process* and reports its port when ready. Electron's run-as-Node and
  Node-options fuses are off, and the app only loads code from its own package.
* **Preload bridge.** The page can only call a few folder actions (check, browse, use, move, show) and
  receive "open this dialog" messages from the menu; the main process accepts them only from Waymark's
  own pages.
* **First start without a server.** The welcome page is part of the app's files, served from a custom
  `waymark://app/` protocol, because there is no server until a workspace exists. If it ever fails to
  load, a plain dialog asks instead.
* **Moving a workspace.** The server stops, every file is copied and compared by size and SHA-256, then
  the copy opens; the old folder is never deleted, and a failed move removes only its partial copy.
* **Packaging and updates.** electron-builder makes an NSIS installer (Windows, per-user), DMG (macOS,
  Intel and Apple Silicon) and AppImage (Linux). GitHub Actions builds all three when a version tag is
  pushed; the app checks GitHub Releases with electron-updater, downloads in the background and offers
  *Restart now / Later* (on macOS, which needs signing to self-update, it opens the download page).
  Update checks can be turned off.
* **Self-test.** `WAYMARK_SMOKE_TEST=1` starts the packed app, checks the window, maths, PDF fonts,
  backups and the update check (or the welcome page on a first start), prints the result and quits.

---

## 11. How it works with AI agents

**The contract is a file.** `AGENTS.md`, written into every workspace, tells any agent the folder layout,
the checkpoint format, who writes which section, the rules the app enforces, and step-by-step workflows:

| Workflow | What the agent does |
|---|---|
| Start a session | Reads the checkpoint, its parent and your notes; teaches from where you are; writes nothing yet. |
| Wrap up | Appends a dated session note to My notes in your chosen format, adds takeaways, open questions and resources, ticks answered questions, proposes progress only if you said so. |
| Brainstorm | Captures ideas as notes and turns concrete topics into new checkpoints. |
| Quiz me | Asks questions in the chat; records what went well and the gaps. |
| Expand | Adds 3–6 sub-checkpoints with explanations and resources. |
| Draft a roadmap | Creates `roadmap.md` and the main checkpoints. |
| Reorganise | Writes a proposal instead of editing many files. |
| No file access | Replies with a changeset block you paste into *Review → Paste proposal*. |

**How each agent connects**

| Agent | Connection |
|---|---|
| Claude app, Code tab (or Claude Code in a terminal) | Choose the workspace folder; `CLAUDE.md` imports `AGENTS.md`. |
| Claude app, Cowork | Give Claude the folder for a task. |
| Claude chat | A file-access desktop extension allowed only this folder. |
| Codex (ChatGPT desktop app, CLI, editor extension) | Open the folder; Codex reads `AGENTS.md` itself. |
| Cursor, VS Code with GitHub Copilot, Windsurf | Open the folder; they read `AGENTS.md`. |
| Gemini CLI | Run it in the folder; `GEMINI.md` imports `AGENTS.md`. |
| ChatGPT or Claude in a browser | Copy a brief, paste the reply into Review. |

`INDEX.md` gives agents an always-current outline with every id and file and a *Needs attention* list
(broken files, held changes, waiting proposals), so they can check their own work. A typed MCP server is
deliberately deferred: every agent above already edits files, and the guard rules apply however a file
changes.

---

## 12. Safety, privacy and reliability

| Concern | How it is handled |
|---|---|
| Your writing overwritten by AI | Guard rules (section 8): append-only for agents in your sections, human-only fields held, approved content protected. |
| Your own concurrent edits | Field-level compare-and-set with *Keep mine / Use theirs / Compare*. |
| Mistakes | Undo/redo, per-checkpoint history with full text, Trash for checkpoints and roadmaps. |
| Disk problems and crashes | Atomic writes; state rebuilt from files on every start; daily zip backups; `npm run validate` checks a workspace without the app. |
| Broken files | Detected, reported, never overwritten; *Restore* keeps the damaged copy in `.waymark/broken/`. |
| Privacy | No account, no cloud, no telemetry, no AI calls. Waymark goes online only for the desktop app's update check (can be turned off), a video you press play on, and the title of a link you add as a resource. The API listens on 127.0.0.1 and refuses other websites. |
| Off-machine safety | Put the folder in OneDrive/Dropbox or a git repository; everything is text. |
| Wrong folder | The welcome page and Workspace settings refuse whole drives, the user folder, system folders and the install folder, and warn about folders with other files. |

---

## 13. Quality, accessibility and languages

* **Automated tests:** 68 tests in 9 files (vitest) cover the file format, change engine, guard rules,
  conflicts, review, trash, history, folders (including folders moved outside the app), exports, maths,
  sticky notes, outline import, attachments and zip backups (including blocked path tricks), session
  notes, keeping agent formatting, workspace-folder checks and moves, file names in every script, video
  links and timestamps, link titles, streamed media uploads, range requests and media-free backups.
  Windows file-lock behaviour is handled with retries and polling in tests and code.
* **Accessibility check:** `npm run qa:a11y` runs axe-core (the engine behind Lighthouse's accessibility
  audit) on 12 screens and dialogs in light and dark themes and at phone width, 28 combinations, against
  WCAG 2.2 A/AA and best practices. The November 2026 QA pass took it from 53 kinds of problem to none.
* **Keyboard:** skip link; visible focus everywhere; one Tab stop for the map with arrow-key navigation;
  shortcuts never steal keys from buttons and menus; focus returns after dialogs.
* **Screen readers:** landmarks, one heading structure per page, named icons and editors, a spoken
  description of the map's keys.
* **Vision and motion:** text at 4.5:1 or better in both themes; works at 200% zoom; reduce-motion stops
  CSS and map animations.
* **Phones and small windows:** drawers instead of squeezed panels; touch targets of 24 px or more.
* **Languages:** names in any script; right-to-left text (Arabic, Hebrew, Urdu) follows its own
  direction in titles, the outline, the map and notes; search works in any script; exports keep
  non-Latin file names (RFC 6266).
* **Scale:** a generated 1,000-checkpoint roadmap imports in about 5 s on Windows (files written 16 at a
  time) and opens in about 0.1 s.
* The full checklist by kind of user is in [QA.md](QA.md).

---

## 14. Technology stack

| Area | Technology (licence) |
|---|---|
| Language | TypeScript throughout (~16.7k lines in `src/` and `electron/`) |
| UI | React 19, Zustand, Tailwind CSS 4, Radix UI, cmdk, sonner, lucide (MIT/ISC) |
| Map and layout | @xyflow/react 12 (MIT), d3-hierarchy (ISC), html-to-image (MIT) |
| Outline | react-arborist (MIT) |
| Editor and Markdown | Milkdown Crepe 7 / ProseMirror (MIT), react-markdown, remark/micromark/mdast with GFM and math (MIT) |
| Maths, PDF | KaTeX (MIT), Mozilla pdf.js (Apache-2.0) via react-pdf (MIT) |
| Server | Node.js, Hono + @hono/node-server (MIT), chokidar (MIT) |
| Data | zod (MIT), yaml (ISC), jsdiff (BSD-3), nanoid (MIT), fflate (MIT), htmlparser2 (MIT, link titles) |
| Desktop | Electron (MIT), electron-builder, electron-updater (MIT); shell and release pattern from Actual Budget (MIT) |
| Build and test | Vite, esbuild, vitest, axe-core (MPL-2.0, dev only) |
| Fonts | IBM Plex Sans and Mono (OFL), bundled for offline use |
| Repository | `src/client` (UI), `src/server` (engine, API), `src/shared` (format, ops, guard, progress), `electron/` (desktop), `tests/`, `docs/`, `scripts/` |

---

## 15. The market

### Where Waymark sits

Waymark sits where four fast-moving categories meet, and fills a gap none of them covers: a
**persistent, visual, human-owned layer between your AI conversations and your learning or projects**.

```
          learning roadmaps (roadmap.sh)          note-taking / PKM (Notion, Obsidian, Heptabase)
                       \                                   /
                        \                                 /
                         ►   Waymark: a personal map +   ◄
                         ►   notebook, in your files,    ◄
                        /    safe for AI agents to edit   \
                       /                                   \
   AI study tools (NotebookLM, chat study modes)     AI agents with file access (Claude, Codex, Cursor)
```

### Signals of demand

| Signal | Figure | Source |
|---|---|---|
| Students already learn with AI | 95% of UK students use generative AI (HEPI 2026); 92% in the Digital Education Council's 2026 survey; 85% of US college students used AI for coursework in the past year (Inside Higher Ed 2025, cited by Middlebury) | see Sources |
| Roadmaps are a proven format | roadmap.sh's repository has about 350,000+ GitHub stars, among the 10 most-starred projects; the site reports millions of registered users | roadmap.sh, GitHub trackers |
| Local Markdown notes have a large following | Obsidian is estimated at over 1 million users; its plugin and theme ecosystem passed 8,000 projects | third-party estimates; Obsidian blog |
| AI agents that edit files are going mainstream | Codex passed 5 million weekly users in June 2026 (OpenAI), about 20% of them non-developers; Claude Code had millions of weekly users earlier in 2026 | press reports of company statements |
| Money in the categories | AI in education forecast at about USD 32 billion by 2030 (Grand View Research, 31% CAGR); note-taking app market estimates range from about USD 0.9 billion to 18.7 billion depending on the definition | market research firms (directional only) |

Market-size figures from research firms vary widely with their definitions; treat them as direction,
not precision.

### Comparison

| | Waymark | roadmap.sh | Obsidian | Notion (with AI) | NotebookLM | Heptabase |
|---|---|---|---|---|---|---|
| Personal, editable roadmap map | ✓ | hosted roadmaps, progress tracking and custom roadmaps on their site | manual canvas | databases, no map | generated mind maps | visual whiteboards |
| Notebook page per step | ✓ | topic pages (shared content) | ✓ (notes) | ✓ | — | ✓ (cards) |
| Learning model (understanding, evidence, own words) | ✓ | — | via plugins | via templates | quizzes, flashcards | — |
| Your own AI agent edits it directly | ✓ (files + AGENTS.md) | — | ✓ (files), no guard rules | built-in AI only | built-in AI only | built-in AI |
| Protects your writing from AI | ✓ guard rules + review | n/a | — | — | n/a | — |
| Data as local plain files, offline | ✓ | — (cloud) | ✓ | — (cloud) | — (cloud) | — (cloud sync, own format) |
| No AI subscription needed | ✓ (uses yours) | basic free | ✓ | AI is paid | free tier | paid plans |
| Open source | ✓ | content repository (custom licence) | — | — | — | — |

*(Competitor features change often; the table reflects public information in 2026.)*

### Positioning

* **For** learners and makers who already study and plan with Claude, ChatGPT/Codex or Cursor,
* **who** lose what they learn in chat history and want a path they can see and trust,
* **Waymark is** a local roadmap notebook that their own AI agent writes into,
* **unlike** generic roadmaps, cloud notebooks or AI tools with built-in models,
* **it** keeps everything in files they own, protects their writing from AI rewrites, and keeps progress
  honest: only they can mark something learned.

### Target segments, in order

1. **Engineering and computer-science students** who already use AI daily and organise work by semester
   and subject (folders, PDFs, maths, exam progress).
2. **Self-learners and career switchers** following AI/ML, web or data paths.
3. **Developers learning new stacks** with coding agents they already run.
4. **Mentors, teaching assistants and educators** sharing templates and exports.

### Differentiators

* **Agent-agnostic by design:** works with any agent that can edit files, today and as new ones appear.
* **Human-in-the-loop integrity:** the guard rules and Review are the hard part, and no comparable tool
  has them.
* **Ownership:** plain Markdown in your folder; no lock-in, no account, offline.
* **No AI cost on top:** it uses the AI subscription the user already pays for.
* **Inclusive:** accessible, multilingual, works on small screens.

### Possible business models (not decided)

Free and open-source core app; optional paid sync or backup service; curated roadmap templates or a
template marketplace; a classroom or team edition (shared templates, mentor review); donations or
sponsorship.

### Risks

| Risk | Mitigation |
|---|---|
| AI vendors add native memory, projects and study modes | Waymark is vendor-neutral and file-based; it complements any of them and survives switching. |
| roadmap.sh or note apps add personal AI roadmaps | Local ownership, guard rules and bring-your-own-agent remain distinct. |
| Setup friction (an agent that can open folders) | Connect your AI panel, first prompt, copy-and-paste fallback; later a one-click integration. |
| Unsigned installer warnings; macOS untested | Code signing and macOS testing are planned. |
| Agents that ignore `AGENTS.md` | The rules are enforced by the app, not by the agent's goodwill. |
| Small team (one developer) | Composition of mature open-source parts keeps the custom code small; tests and the QA checklist guard quality. |

---

## 16. Status and what comes next

| | |
|---|---|
| Released | 0.1.0 and 0.1.1 (Windows installer, macOS DMG and Linux AppImage built by CI; auto-update working from GitHub Releases) |
| Ready for 0.1.2 | Customisable toolbars; first-start welcome page, Connect your AI, workspace switch and verified move, `GEMINI.md`; the accessibility, keyboard, language and large-roadmap QA fixes; video, audio and document attachments, YouTube/Vimeo/Loom playing inside the app, automatic link titles |
| Tested on | Windows 11 (desktop and browser); macOS and Linux builds are produced but not yet tested by hand |
| Next candidates | Code signing; macOS testing; a one-click Claude Desktop extension and a typed MCP server; testing with real screen readers (NVDA, VoiceOver); cross-roadmap links; cloud sync or a web version for other devices (PLATFORMS.md, stage 3); a template gallery |

---

## 17. Glossary

| Term | Meaning |
|---|---|
| Workspace | The folder that holds all your roadmaps; shared with your AI agents. |
| Checkpoint | A step on a roadmap with its own notebook page. |
| Main path | The spine of main checkpoints down the left of the map. |
| Profile | General or Learning: which sections and statuses a roadmap has. |
| Draft / approved | Draft = not yet checked by you; approved = protected from agent rewrites. |
| Held change | An agent change the app refused to apply and kept for your decision. |
| Review | The inbox of agent changes, held changes and proposals. |
| Proposal / changeset | A file describing several changes (add, update, move, delete, link) to preview and apply. |
| `AGENTS.md` | The instructions every agent reads before editing the workspace. |
| `INDEX.md`, `LIBRARY.md` | Generated outlines for agents (and humans). |
| `rev` | A per-file version number used to detect edits made from an old copy. |
| Bundle | A `.waymark.json` file with one roadmap's data; a `.waymark.zip` adds its attachments. |

---

## 18. Sources

Project documents: [README](../README.md), [DESIGN.md](DESIGN.md), [DATA-FORMAT.md](DATA-FORMAT.md),
[PLATFORMS.md](PLATFORMS.md), [QA.md](QA.md), [MEDIA.md](MEDIA.md).

Market and ecosystem (third-party figures are approximate):

- [roadmap.sh repository statistics (ghtrends)](https://ghtrends.pages.dev/nilbuild/developer-roadmap/) ·
  [awesome.ecosyste.ms entry](https://awesome.ecosyste.ms/projects/github.com%2Fnilbuild%2Fdeveloper-roadmap) ·
  [roadmap.sh: about](https://roadmap.sh/about) · [roadmap.sh: advertise](https://roadmap.sh/advertise)
- [Obsidian statistics (Fueler)](https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics) ·
  [Obsidian blog: 2026 Obsidian October](https://obsidian.md/sv/blog/2026-obsidian-october/) ·
  [Obsidian ecosystem statistics](https://publish.obsidian.md/hub/04+-+Guides%2C+Workflows%2C+%26+Courses/Guides/Obsidian+ecosystem+statistics)
- [GenAI use by design students, citing HEPI 2026 (arXiv)](https://arxiv.org/pdf/2607.17094) ·
  [Digital Education Council: AI adoption among students](https://www.digitaleducationcouncil.com/post/ai-adoption-is-nearly-universal-among-students-but-confidence-is-not) ·
  [Generative AI in Higher Education, Middlebury (arXiv)](https://arxiv.org/pdf/2508.00717)
- [Grand View Research: AI in education (via GII)](https://www.giiresearch.com/report/grvi1611683-ai-education-market-size-share-trends-analysis.html) ·
  [Grand View Research: AI tutors](https://www.dri.co.jp/auto/report/grandview/250113-ai-tutors-market-size-share-trends.html)
- Note-taking app market estimates:
  [Research and Markets](https://www.researchandmarkets.com/reports/5790688/note-taking-app-market-report) ·
  [Emergen Research](https://www.emergenresearch.com/industry-report/note-taking-app-market) ·
  [The Business Research Company](https://www.thebusinessresearchcompany.com/report/note-taking-app-global-market-report) ·
  [Business Research Insights](https://www.businessresearchinsights.com/market-reports/note-taking-app-market-106125)
- AI agents: [Codex (Wikipedia)](https://en.wikipedia.org/wiki/Codex_(AI_agent)) ·
  [Codex passes 5M weekly users](https://tech-insider.org/ie/openai-codex-5-million-users-2026/) ·
  [Codex vs Claude Code user numbers (AgentConn)](https://agentconn.com/blog/codex-vs-claude-code-7m-users/) ·
  [AI coding agent adoption survey data](https://codex.danielvaughan.com/2026/04/26/ai-coding-agent-adoption-2026-survey-data-codex-cli-positioning/)
- Comparable tools: [NotebookLM learning guide (KDnuggets)](https://www.kdnuggets.com/the-ultimate-guide-to-learning-anything-with-notebooklm) ·
  [Heptabase pricing (toolradar)](https://toolradar.com/tools/heptabase/pricing) ·
  [Notion (Wikipedia)](https://en.wikipedia.org/wiki/Notion_(productivity_software)) ·
  [Obsidian (Wikipedia)](https://en.wikipedia.org/wiki/Obsidian_(software))
- Agent conventions: [AGENTS.md](https://agents.md/) ·
  [Gemini CLI memory import](https://geminicli.com/docs/reference/memport/) ·
  [Claude Desktop local MCP servers and extensions](https://support.claude.com/en/articles/10949351) ·
  [ChatGPT desktop app (Codex)](https://learn.chatgpt.com/docs/app)
