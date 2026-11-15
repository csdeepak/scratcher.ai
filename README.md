# Waymark

A local roadmap notebook you own. Plans become a map of **checkpoints**; each checkpoint opens into a
notebook page for content, your notes, takeaways, questions, resources and progress.

Your data is a folder of plain Markdown files. **Any AI agent that can edit files** (Claude Code, Claude
Desktop with file access, Codex, Cursor, …) edits the same folder; Waymark shows the change within a
second, protects your notes and progress, and lets you keep or revert what the agent did. No account,
no subscription, no AI API, no internet needed after installing.

- Design and decisions: [docs/DESIGN.md](docs/DESIGN.md)
- File formats, changesets, export bundles, local API: [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md)
- Instructions agents read: `workspace/AGENTS.md` (written on first start)

## Install and run

Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:4317. The first start creates `./workspace` with a small example roadmap
(“Learn Git fundamentals”) that shows every feature; delete it whenever you like.

Options: `npm start -- --workspace "D:/Roadmaps" --port 4400` (or `WAYMARK_WORKSPACE`, `WAYMARK_PORT`).
In Chrome or Edge you can install the page as an app (address bar → Install) for its own window.

Development: `npm run dev` (UI on :5173 with hot reload, API on :4317). Tests: `npm test`.

## Everyday use

| Do | How |
|---|---|
| New roadmap | **New roadmap**: pick *Learning* (adds objectives, practice, evidence, understanding) or *General* |
| Add checkpoints | Toolbar **+ Main checkpoint**, or select one and press **A** (sub-checkpoint) / **N** (next) |
| Reorganise | Drag in the outline, **Tab / Shift+Tab** to indent, **Alt+↑/↓** to reorder, drag on the map for manual position |
| Work on one part | Select it and press **F** (focus); **O** returns to the overview |
| Write | Click any section to edit (visual editor, or `</>` for Markdown); it saves as you type |
| Progress | Set status yourself; learning roadmaps also have “can I explain / apply it?” |
| Find | **Ctrl+K** searches titles and notes across all roadmaps |
| Undo | **Ctrl+Z**; History (per checkpoint) restores any earlier version; deleted items go to Trash |

Progress of a checkpoint = completed sub-checkpoints ÷ all sub-checkpoints at every level below it,
ignoring optional and archived ones. A parent is never completed automatically.

## Working with an agent

1. Open your **workspace folder** in the agent (in Claude Code: `cd workspace` then `claude`, or open
   the folder in the desktop app's Code tab). `CLAUDE.md` makes Claude read `AGENTS.md`.
2. Ask, e.g. *“Read AGENTS.md. In the roadmap ‘Learn Git fundamentals’, expand ‘Branching and merging’
   into 4 sub-checkpoints with short explanations and good resources.”*
3. Watch the map update. Open **Review** to keep or revert each change.

What the app guarantees whatever the agent does:

- Your **notes, takeaways, own-words, evidence, status, understanding and approvals** are never changed
  by an outside edit; such edits are put back in the file and wait in Review for your decision.
- **Approved** checkpoints and branches you **lock** are protected the same way.
- If an agent writes an **old copy** of a file (based on an older `rev`), your newer changes win and the
  agent's conflicting values wait in Review.
- **Deleting** a file that holds your work is undone and held for review; other deletions go to Trash.
- Broken files are reported (in the app and in `INDEX.md`) and never overwritten.
- For big reorganisations agents write a **proposal** (`proposals/*.yaml`) you preview change by change.

No file access (e.g. ChatGPT or Claude on the web)? **⋯ → Work with an agent → Chat without file
access** copies a brief; paste the reply in **Review → Paste proposal**.

Which agent can reach your files: Claude Code, Codex CLI, Cursor, VS Code agents and Gemini CLI can when
opened in the folder. Claude Desktop (chat) needs a filesystem connector you enable for this folder.
A Claude or ChatGPT subscription alone does not give an agent access to your computer.

## Your data, backups and recovery

- Everything is in the workspace folder: `roadmaps/<name>/roadmap.md`, `checkpoints/*.md`,
  `layout.json`, `proposals/`. Close the app and the files are still readable notes.
- **Autosave** writes atomically (temp file → flush → rename); the status shows *Saved*, *Saving…*,
  *Not saved* (with the reason) or *Offline* (edits are kept in the browser and saved when the server is
  back). Browser storage is only that short-term buffer and remembers view settings; it is never the
  copy of record.
- **History** of every change (yours, agents', imports) is in `.waymark/history/` with full before/after
  text; restore from a checkpoint's History section.
- **Trash** (menu → Trash) restores deleted checkpoints and whole roadmaps.
- **Daily backups**: the first save each day writes `backups/YYYY-MM-DD/<roadmap>.waymark.json`
  (30 days kept); menu → *Back up now* any time. Restore one with menu → *Import*.
- For off-machine safety put the workspace in OneDrive/Dropbox or `git init` it; everything is text.
- Check a workspace without starting the app: `npm run validate` (or `npm run validate -- "<folder>"`).

If something looks wrong: stop the app (Ctrl+C), copy the workspace folder, then restore from History,
Trash or a backup. Damaged files are kept in `.waymark/broken/` when you choose *Restore* on a problem.

## What works and what's next

Works now: multiple roadmaps, nested checkpoints, auto-laid-out map with manual dragging, outline,
focus/overview, notebook sections with a visual Markdown editor, resources with video timestamps,
statuses + understanding + approval, progress, autosave and offline queue, live agent edits with guard
rules, review inbox, proposals, conflict detection, history/undo/trash, export/import, templates,
daily backups, search, keyboard shortcuts, light/dark themes, small screens. 22 automated tests cover
the file format, change engine, guard rules, conflicts, review, trash, history and export/import.

Not yet (by design for v1): accounts, multi-person collaboration, cloud sync, built-in AI, an MCP server
(file access already covers Claude), maths rendering, embedded media, custom field profiles in the UI,
cross-roadmap links, a desktop wrapper.

## Licence of dependencies

All runtime dependencies are open source: React, React Flow (@xyflow/react), d3-hierarchy, Milkdown,
react-arborist, Radix UI, cmdk, sonner, lucide, Tailwind CSS, Hono, chokidar, zod, yaml, jsdiff, nanoid
(MIT/ISC/BSD), IBM Plex fonts (OFL). Waymark makes no network requests while running.
