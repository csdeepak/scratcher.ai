# Waymark — design

Waymark is a local roadmap notebook. A roadmap is a map of **checkpoints**. Each checkpoint opens into a notebook page. Your roadmaps live as plain Markdown files in a folder you own. Any AI agent that can edit files (Claude Code, Claude Desktop with file access, Codex, Cursor, and others) edits that same folder. The app watches the folder and shows changes as they happen. It protects your notes and progress, and it lets you review, keep, or undo what the agent changed.

The tool and the content are separate. Waymark has no built-in subjects. A learning syllabus, a project plan, or any other goal is content you create inside it.

---

## 1. Product definition

| | |
|---|---|
| **What it is** | A visual, zoomable map of checkpoints and sub-checkpoints. Clicking a checkpoint opens its notebook page: content, your notes, takeaways, questions, resources, and progress. |
| **Who writes** | An external agent does most of the drafting and organising. You are the senior editor: you inspect, rewrite, approve, and decide what is complete or understood. |
| **Where data lives** | One folder (the *workspace*) of Markdown + YAML files. These files are the single source of truth: readable without the app, easy to back up, and easy for agents to edit. |
| **What it needs** | Node.js. No account, subscription, hosted service, or AI API. Works offline. |
| **What it is not** | Not a project-management suite, not a diagram drawing tool, not a workflow-automation editor, and it does not call any AI itself. |

### Main user journeys

1. **Start a roadmap.** Click *New roadmap*, choose *General* or *Learning*, type a goal. Add 3–6 main checkpoints, or ask your agent: “Read AGENTS.md, then draft the roadmap *Learn X*.” The checkpoints appear on the map as the agent writes them, marked **Draft**.
2. **Inspect and correct.** Click through the map or the outline. Edit titles and text inline. Approve sections you're happy with. Approved sections are protected from later agent rewrites.
3. **Work on one checkpoint.** Focus it (`F`): the rest of the map collapses but stays in view. Ask the agent to expand only this checkpoint. Its new sub-checkpoints appear and are listed in **Review** as unreviewed.
4. **Learn or work.** Write notes, record takeaways and questions, attach resources and video timestamps, and tick checklist items. Set the status yourself. In learning roadmaps, also rate your own understanding.
5. **Refine together.** The agent re-reads the files, including your edits, and revises them. If it touches something you own (notes, status, an approved section), the app holds that change for your decision and keeps your version in the file.
6. **Restructure safely.** Moves, deletions, and large reorganisations arrive as a *proposal* that you review change by change. Anything else can be reverted from History; deleted checkpoints go to Trash.
7. **Keep going.** Export, back up, or turn a roadmap's structure into a template for the next one.

---

## 2. Research: reuse vs. build

### Option A — extend an existing application

| Candidate | License | What it gives | Why not as the foundation |
|---|---|---|---|
| [Obsidian](https://obsidian.md) + Canvas ([JSON Canvas spec](https://jsoncanvas.org), MIT) | Proprietary app, free | Local Markdown vault; agents can edit files | You can't own or change the app's source. Canvas positions are drawn by hand: no auto-layout, status, or progress model. |
| [Logseq](https://github.com/logseq/logseq) | AGPL-3.0 | Local outliner, Markdown files | The file-based version is in maintenance mode, and the DB version moves to SQLite ([announcement](https://logseq.io/p/e3YDyX5AYr)). It has no roadmap canvas, and the Clojure codebase is costly to extend. |
| [developer-roadmap / roadmap.sh](https://github.com/kamranahmedse/developer-roadmap) | Custom, redistribution restricted; editor not public | The look of a roadmap | Not reusable: the editor is closed and the license is restrictive. |
| [Markmap](https://github.com/markmap/markmap) | MIT | Markdown outline → mind-map view | Read-only. No per-node notebook, status, or editing. |
| [Trilium/TriliumNext](https://github.com/TriliumNext/Notes) | AGPL-3.0 | Hierarchical notes, relation maps | Large app, data in SQLite, high adaptation cost. |
| Small hackathon roadmap apps (e.g. [GitNodes](https://github.com/andreabozzo/gitnodes), [xelearning/roadmap](https://github.com/xelearning/roadmap)) | Various | Partial ideas | Immature, or missing notes, review, and agent safety. |

**Conclusion:** none of these provides more than about 20% of the requirements. Adapting one would cost more than composing proven components. The hard parts here are the agent-safe file model and review, which none of them has.

### Option B — compose a focused app from mature components (chosen)

| Need | Component (license) | What it already supplies | What we build |
|---|---|---|---|
| Zoomable, pannable canvas | [React Flow / @xyflow/react](https://github.com/xyflow/xyflow) 12 (MIT; Pro tier only sells examples and support) | Pan/zoom, custom React nodes, edges, minimap, controls, fitView, viewport culling, keyboard a11y | Checkpoint node design, edge styles, focus/expand behaviour |
| Automatic layout | [d3-hierarchy](https://github.com/d3/d3-hierarchy) (ISC): Reingold–Tilford tidy tree | Proven, compact, deterministic tree layout | Mapping checkpoints to a tree, the main-path spine, manual offsets on top |
| Rich text notes | [Milkdown Crepe](https://github.com/Milkdown/milkdown) 7 (MIT): ProseMirror + remark | WYSIWYG Markdown with headings, lists, task lists, links, code blocks (CodeMirror), tables. Markdown in and out. | Section framing, autosave, conflict banner, raw-Markdown fallback |
| Outline tree | [react-arborist](https://github.com/brimdata/react-arborist) 4 (MIT) | Virtualised tree, drag-and-drop reparent/reorder, inline rename, keyboard nav, ARIA | Mapping to move/rename ops, status glyphs |
| UI primitives | [Radix UI](https://github.com/radix-ui/primitives), [cmdk](https://github.com/pacocoursey/cmdk), [sonner](https://github.com/emilkowalski/sonner), [lucide](https://github.com/lucide-icons/lucide), [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (MIT/ISC) | Accessible dialogs, menus, popovers, command palette, toasts, icons | Visual system (tokens, light/dark theme) |
| Markdown preview | react-markdown + remark-gfm (MIT) | Safe rendering of GFM | Clickable task checkboxes |
| Local server + file watching | [Hono](https://github.com/honojs/hono) + @hono/node-server (MIT), [chokidar](https://github.com/paulmillr/chokidar) (MIT) | Small HTTP server; reliable cross-platform watching | Workspace engine: parse, guard, merge, history |
| Validation and formats | [zod](https://github.com/colinhacks/zod) (MIT), [yaml](https://github.com/eemeli/yaml) (ISC), [jsdiff](https://github.com/kpdecker/jsdiff) (BSD-3), nanoid (MIT) | Schemas, YAML front matter, text diffs, ids | The data format, changesets, migrations |

Considered and not chosen: **elkjs** (EPL-2.0) and **dagre** (MIT) are general DAG layouts. A tidy tree reads better for nested checkpoints, and prerequisites are drawn on top of it. elkjs is the upgrade path if DAG-first layout is ever needed. **Tiptap** (MIT core) is also good, but Milkdown is Markdown-native, which matters because agents write Markdown. **BlockNote** exports Markdown lossily. **Electron/Tauri** is deferred: a localhost page can be installed as a browser app window.

**Agent skills reviewed:** Anthropic's [`frontend-design`](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) skill is guidance only, with no scripts. I used its quality floor: visible focus, contrast, reduced motion, plain copy, and avoiding template clichés. No skill scripts were installed or run.

---

## 3. Screen layout

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│ ◇ Waymark  ▸ Learn Git ▾        [ Search…  Ctrl K ]       ● Saved   Review 3   ⋯       │
├──────────────┬─────────────────────────────────────────────┬──────────────────────────┤
│ OUTLINE      │                                             │ Learn Git › Branching    │
│ ▾ Basics  ●  │   ┌──────────┐     ┌──────────┐             │ Branching and merging    │
│   · Commits  │   │ Basics   │────▶│ Commits  │             │ ● In progress  ◐ explain │
│ ▸ Branching ◐│   │ ▓▓▓░ 3/4 │     └──────────┘             │ ─────────────────────── │
│ ▸ Remotes    │   └────┬─────┘                              │ Content          Draft ✎ │
│              │        │ (main path)                        │ My notes        (yours)  │
│              │   ┌────▼─────┐  ┄┄requires┄┄▶               │ Key takeaways            │
│              │   │Branching │                              │ Open questions           │
│              │   └──────────┘           [minimap] [+ − ⤢]  │ Resources ▸ ▶ 12:30      │
│ + Checkpoint │                                             │ History · Archive        │
└──────────────┴─────────────────────────────────────────────┴──────────────────────────┘
```

* **Top bar:** roadmap switcher, search/command palette, save state (*Saved / Saving… / Not saved: retrying / Server offline: changes kept locally*), **Review** with a count of pending items, and a menu (export, import, backup, templates, trash, agent setup, theme).
* **Attachments and viewer:** images and PDFs belong to a checkpoint (drop, paste or add). A full-screen viewer shows images and PDFs (pdf.js, offline) with working links.
* **Library (far left):** all roadmaps in nested folders with colour tabs, like a notebook's section list. Folders are real folders under `roadmaps/`. Drag a roadmap onto a folder to move it, and use the ⋯ menu for colour, export and settings.
* **Outline (left):** a tree synchronised with the map. Supports drag-and-drop, inline rename, and keyboard navigation. Collapsible.
* **Map (centre):** main checkpoints run down a *main path* spine. Sub-checkpoints branch to the right. Solid curves are parent→child links; dashed arrows are prerequisites (highlighted for the selected checkpoint). Optional checkpoints have dashed borders. Collapsed nodes show a “+n” chip. `F` focuses one branch, `O` returns to the overview.
* **Details (right):** breadcrumb, title, status, understanding (learning roadmaps), and an approval switch. Below, the notebook sections in reading order. Each section shows who owns it (*agent-maintained* vs *yours*). Click a section to edit it. Then resources, completion criterion, prerequisites, and history. The panel can expand to a full page for writing.
* **Narrow screens:** the outline and details become slide-over drawers, and the map stays full-width.

---

## 4. Scope

**First usable version (built here):** multiple roadmaps; nested checkpoints; map with automatic layout and optional dragging; outline; details editor with notes, takeaways, questions, and resources (with timestamps); General and Learning profiles; statuses, understanding, and transparent progress; autosave with visible state; live reflection of external edits; guard rules; review inbox; proposals; conflict detection; history and restore; trash; export and import; daily backups; search; structure templates; agent guide (AGENTS.md) and generated INDEX.md; copy/paste fallback for chat-only agents; an example roadmap.

**Deferred:** accounts, multi-person collaboration, cloud sync (put the folder in OneDrive or git instead), built-in AI, analytics, scheduling, media storage or embedding, plugin system, MCP server (files already cover Claude; MCP would add typed tools later), desktop wrapper, cross-roadmap links, custom field profiles in the UI.

---

## 5. Technical foundation and trade-offs

* **Local Node server + browser UI** (`npm start` → `http://localhost:4317`). A browser alone can't watch a folder reliably or write files without repeated permission prompts. A ~1k-line Node server can, and it is the single writer that applies guard rules.
  *Trade-off:* you run one command. Data never passes through browser storage, which removes the durability limits of browser storage.
* **Markdown files as the database.** Agents and humans can read and edit them, they diff well in git, and you lose no data if the app disappears.
  *Trade-off:* parsing on every change (fast for thousands of files), and free-form editing can break a file. Broken files are detected, shown, and never overwritten.
* **React 19 + TypeScript + Vite**, with **zustand** for client state. The same `src/shared` code (schema, parser, change engine) runs in the server, the client, and the tests.
* **Visual language: modelled on learning-roadmap tools (roadmap.sh style),** chosen over a generic dark dashboard. It uses a paper canvas with a faint grid, bold yellow main checkpoints with ink borders, and cream sub-checkpoints. Status is shown as fill colour: blue = in progress, amber = needs review, green = complete. A thick blue line marks the main path, and dashed arrows mean "requires". The type is IBM Plex Sans/Mono (OFL, bundled for offline use). Light is the default theme; a matching dark theme is available.

| Confirmed by docs/registry | Assumption to validate | Custom work |
|---|---|---|
| Licenses above (npm registry, Nov 2026); React Flow core MIT; react-arborist DnD/rename/keyboard; Crepe GFM features | Crepe round-trips agent Markdown without loss (mitigated: lossy sections open in raw Markdown); chokidar events on Windows for agent writes | Workspace engine, guard/merge, review, layout mapping, UI |

---

## 6. Data model

### Workspace folder

```
workspace/
  AGENTS.md                 instructions for any agent (CLAUDE.md imports it)
  roadmaps/
    learn-git/
      roadmap.md            roadmap settings (front matter) + overview for the agent
      INDEX.md              generated outline with ids, status, files, problems (read-only)
      layout.json           optional manual position offsets
      checkpoints/
        branching-and-merging.md
      proposals/            agent-written changesets waiting for review
  templates/                reusable roadmap structures (*.json bundles without notes/progress)
  backups/YYYY-MM-DD/       daily full backups, .waymark.zip with attachments (last 30 days)
  .waymark/                 app-internal: history, review queue, trash, archived proposals
```

### Checkpoint file

```markdown
---
id: cp-k3x9a2mf            # stable identity; never changes (files can be renamed)
title: Branching and merging
parent: cp-a81bz0qq         # omit for a main checkpoint
order: 2                    # position among siblings (decimals allowed: 2.5)
summary: Work on parallel lines of development and bring them together.
status: in-progress         # yours
understanding: can-explain  # yours (learning profile)
approved: false             # yours: true protects agent-maintained content
optional: false
prerequisites: [cp-q1w2e3r4]
completion: Can create, merge and resolve a conflicting branch unaided.
resources:
  - title: Pro Git — Branching
    url: https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell
    kind: book
  - title: Merge conflicts walkthrough
    url: https://example.com/video
    kind: video
    start: "12:30"
rev: 7                      # version counter; the app bumps it, agents leave it as read
---

# Content
Agent-maintained explanation…

# My notes
Yours. Agents can read it but their edits are held for your approval.
```

**Sections** are top-level `#` headings with fixed names. Use `##` and below inside a section. Each profile defines its sections and owner:

| Key | Heading | Owner | Profiles |
|---|---|---|---|
| content | Content | shared | all |
| objectives | Objectives | shared | learning |
| known | What I already know | **you** | learning |
| toLearn | What I need to learn | shared | learning |
| practice | Practice | shared | learning |
| notes | My notes | **you** | all |
| takeaways | Key takeaways | **you** | all |
| questions | Open questions | shared | all |
| evidence | Evidence | **you** | learning |
| ownWords | In my own words | **you** | learning |

**Statuses** (profile-defined, each mapped to a category):
* General: Not started · In progress · Needs review · Complete.
* Learning: Not started · Learning · Practising · Needs review · Complete.

**Understanding** (learning profile, yours only): *Not yet · Can explain · Can explain and apply*.

**Three separate axes:** content *draft/approved* (`approved`), task progress (`status`), and understanding demonstrated (`understanding`). Generating content never changes the last two.

**Connections:** the hierarchy comes from `parent`. Prerequisites are explicit (`prerequisites` lists the checkpoints this one requires). Optional paths use `optional: true`. Sibling `order` sets the main-path sequence.

### Progress rule (shown in the app)

> **Progress of a checkpoint** = completed sub-checkpoints ÷ all sub-checkpoints, counting every level below it. Optional and archived checkpoints are left out. A checkpoint's own status is never changed automatically. When every sub-checkpoint is complete, the app suggests marking the parent complete but doesn't do it. **Roadmap progress** is the same rule applied to all checkpoints. For learning roadmaps, *understood* (can explain or can apply) is counted and shown separately.

---

## 7. Agent editing interface

### How each agent connects

| Agent | Access to your data | Setup |
|---|---|---|
| Claude Code (CLI, or desktop app Code tab) | Direct file edits | Open the `workspace` folder. `CLAUDE.md` loads `AGENTS.md`. Needs your Claude login. |
| Claude Desktop (chat) | Direct file edits | Enable a filesystem connector/extension with access to the workspace folder. A subscription alone does not grant file access. |
| Codex CLI, Cursor, VS Code agents, Gemini CLI | Direct file edits | Open the workspace folder. Point them at `AGENTS.md`. |
| ChatGPT / Claude web chat (no file access) | Copy/paste | *Copy for AI* puts a brief (instructions, roadmap or section, format) on your clipboard. Paste the agent's reply into *Review → Paste proposal* to preview it. |
| Scripts | Local HTTP API on `localhost` | Documented in `docs/DATA-FORMAT.md`. |

### Two ways an agent can change things

1. **Direct edits:** edit checkpoint files or add new ones. Best for drafting content, expanding a section, and adding resources.
2. **Proposals:** write `roadmaps/<slug>/proposals/<name>.yaml` (a *changeset*). Use these for moves, deletions, and reorganisation. You review them change by change.

Changeset operations: `add`, `update` (partial `set`, optional `rev`), `move` (`parent`, `after`), `delete`, `link`/`unlink` (prerequisites). The app's own UI uses the same operations, through the same engine and validation.

### Guard rules (the app enforces them when it detects an external edit)

| Edit by an agent | Result |
|---|---|
| Shared content in a checkpoint you haven't approved | **Applied live**, marked *unreviewed* in Review: *Keep* or *Revert*. Within a section you set to `agentAccess: direct`, applied without review. |
| Your fields (status, understanding, approved, archived, agentAccess) or your sections | **Held.** The file is restored and the change waits in Review (*Apply* / *Discard*). |
| Approved checkpoint, or section set to `agentAccess: locked` | **Held.** |
| Deleting a checkpoint with your content, approval, or children | **Held** (the file is restored). Other deletions go to Trash and are listed. |
| A write based on an older `rev` than the current one | Merged field by field (three-way). Fields you changed since then are kept, and the agent's version is **held** as a conflict. |
| A file that doesn't parse | The last good version stays in the app and the problem appears in the app and in INDEX.md. The file is never overwritten until it's fixed or you restore it. |
| New checkpoint file | Added as **Draft** (`approved: false`), status *Not started*. |

The app never silently overwrites a newer human change. Its own saves are field-level compare-and-set: if a section changed outside the app while you were editing it, you get *Keep mine / Use theirs / Compare*.

---

## 8. Persistence, backup, recovery

* **Autosave:** edits are sent as operations about 0.6 s after you stop typing. Files are written atomically (write temp → fsync → rename), and the response confirms the write before the indicator says *Saved*. Unsent operations are kept in browser storage (an outbox) and replayed if the server was unreachable. This is only a short-term buffer; the files are the real store.
* **Reopen:** state is rebuilt from the files on every start. UI state (expanded nodes, panel widths, selection) is kept per browser and is safe to lose.
* **History:** every change (app, agent, proposal, import, restore) is appended to `.waymark/history/<roadmap>.jsonl` with full before/after file text. Rapid app edits are coalesced per checkpoint. You can restore any checkpoint version or revert an individual change field by field.
* **Trash:** deleted checkpoints are kept in `.waymark/trash/` until you restore or empty them. Deleting from the UI asks for confirmation when a checkpoint has content or children, and always offers *Undo*.
* **Backups:** each day the first save writes `backups/YYYY-MM-DD/<slug>.waymark.zip` for each roadmap: the bundle plus every attached image and PDF (the last 30 days are kept). *Backup now* is in the menu. For off-machine safety, put the workspace in OneDrive or Dropbox, or `git init` it. Notes stay plain text; the zip is an ordinary archive any tool can open.
* **Export/import:** `*.waymark.zip` (full backup) or `*.waymark.json` (data only), a bundle with `format`, `schemaVersion`, the roadmap, checkpoints (sections included), and layout. Import validates and migrates the bundle, restores only well-formed attachment paths, then always creates a new roadmap, so nothing is overwritten.
* **Maths:** LaTeX in `$…$` / `$$…$$`, rendered by KaTeX (remark-math in the reading view, Milkdown's LaTeX feature in the editor, micromark's math extension in exports). Editing elsewhere in a section keeps maths exactly as written (preserveFormatting treats `$$x$$` and a multi-line `$$` block as the same node). Print views link the app's KaTeX stylesheet; downloaded web pages embed it with its fonts.
* **Schema versions:** `roadmap.md` carries `schema: waymark/1`; bundles and changesets carry their own versions. Migrations are pure functions `vN → vN+1` in `src/shared/migrations.ts`, run on load and on import.

---

## 9. Phased plan (each phase is usable)

| Phase | Outcome |
|---|---|
| 1. Files + map | Create roadmaps and checkpoints, auto-layout map, outline, details editor, autosave, live reload of external edits. You can already use it with Claude Code. |
| 2. Safety | Guard rules, history and restore, trash, conflict detection, review inbox, proposals. Agent edits become safe by default. |
| 3. Portability | Export/import, backups, templates, search, AGENTS.md/INDEX.md, copy/paste fallback. |
| 4. Polish | Keyboard shortcuts, dark mode, small screens, performance on 500+ checkpoints, docs. |

All four phases are implemented in this repository. The architecture for agent and human editing is in place from Phase 1.

## 10. Acceptance criteria (first usable version)

1. Create two roadmaps (General and Learning). Add, rename, reorder, move, archive, and delete checkpoints from both the map and the outline. Notes survive renames and moves.
2. The map auto-lays out 500 checkpoints, pans and zooms smoothly, and collapses and expands branches. Focus mode shows one branch and the overview is one key away.
3. Notes support headings, lists, task lists, links, and code blocks. Agent Markdown with tables and HTML is never lost.
4. Close and restart the app: everything is restored from the files. Stopping the server mid-edit shows *Server offline* and saves once it's back.
5. An external edit to a checkpoint file appears in the open app within about 1 s and is listed in Review. *Revert* restores the previous text.
6. An external edit to *My notes* or `status` is held, and the file keeps your version.
7. An external write based on an older `rev` keeps your newer change and holds the agent's version as a conflict.
8. A proposal file with add/move/delete can be previewed, partially applied, and rejected.
9. Export → import produces an identical roadmap. A malformed import is rejected with a readable message.
10. Any checkpoint version can be restored from History, and a deleted checkpoint can be restored from Trash.

## 11. Defaults chosen (no questions needed)

* The workspace is `./workspace` next to the app (gitignored). Override with `WAYMARK_WORKSPACE`.
* Port 4317, localhost only.
* Agents may edit directly with review by default. Direct-edit and locked sections are opt-in per checkpoint.
* No telemetry and no network calls at runtime. Fonts and icons are bundled.
