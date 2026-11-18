# Waymark

A local roadmap notebook you own. Plans become a map of **checkpoints**; each checkpoint opens into a
notebook page for content, your notes, takeaways, questions, resources and progress.

Your data is a folder of plain Markdown files. **Any AI agent that can edit files** (Claude Code, Claude
Desktop with file access, Codex, Cursor, …) edits the same folder; Waymark shows the change within a
second, protects your notes and progress, and lets you keep or revert what the agent did. No account,
no subscription, no AI API, no internet needed after installing.

- Design and decisions: [docs/DESIGN.md](docs/DESIGN.md)
- File formats, changesets, export bundles, local API: [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md)
- Windows, macOS, desktop installer and web plans: [docs/PLATFORMS.md](docs/PLATFORMS.md)
- Instructions agents read: `workspace/AGENTS.md` (written on first start)

## Install and run

**Desktop app (Windows):** build the installer once with `npm install` then `npm run dist:win`, and run
`release/Waymark-Setup-<version>.exe`. Waymark then starts like any other app (Start menu or desktop
shortcut) and needs no terminal. On the first start a welcome page asks where your notes should live
(suggested: `Documents\Waymark`, or any folder you choose: it checks the folder first and warns if it
already holds other files), then shows how to connect Claude, ChatGPT or another agent to that folder.
Change or move the folder later with **File → Workspace folder**: *Move my workspace here* copies
everything, checks every file, then switches; the old folder is left for you to delete.
The installer isn't code-signed yet, so Windows SmartScreen asks first: *More info → Run anyway*. Mac and
Linux builds: `npm run dist:mac` / `npm run dist:linux`. Releases are built by GitHub Actions and the
installed app updates itself (see [docs/PLATFORMS.md](docs/PLATFORMS.md#releases-and-auto-update)).

**In the browser** (any system). Needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:4317. The first start creates `./workspace` with a small example roadmap
(“Learn Git fundamentals”) that shows every feature; delete it whenever you like.

Options: `npm start -- --workspace "D:/Roadmaps" --port 4400` (or `WAYMARK_WORKSPACE`, `WAYMARK_PORT`).
In Chrome or Edge you can install the page as an app (address bar → Install) for its own window.

Development: `npm run dev` (UI on :5173 with hot reload, API on :4317). Tests: `npm test`. Accessibility,
keyboard, language and large-roadmap checks before a release: [docs/QA.md](docs/QA.md) (`npm run qa:a11y`).

## Everyday use

| Do | How |
|---|---|
| Switch roadmaps | The **Library** on the left lists every roadmap in folders with colour tabs, like notebook sections; one click opens one. Toggle it with the notebook icon. |
| Organise | Library → new folder (folders can nest, e.g. *Learning / Semester 5*); drag a roadmap onto a folder; ⋯ on a roadmap for colour and *Move to* |
| New roadmap | **New roadmap**: pick *Learning* (adds objectives, practice, evidence, understanding) or *General*, a folder and a colour |
| Export | ⋯ → **Export**: PDF (print view → *Save as PDF*), web page, Markdown, map image (PNG), OPML for mind-map apps, or a full backup. Whole roadmap or one branch; with or without your personal notes. |
| Import | **Import**: a full backup (`.waymark.zip`, attachments included) or data file (`.waymark.json`), a Markdown outline (headings and lists become checkpoints, e.g. a syllabus pasted from a chat), or OPML from mind-map apps |
| Files and media | Drop them on a checkpoint's page, paste a screenshot (Ctrl+V), or use **Attachments → Add**: images, PDFs, video (MP4, MOV, WebM, up to 500 MB), audio (MP3, M4A, WAV, OGG, FLAC) and documents (Word, Excel, PowerPoint, text, CSV, notebooks, EPUB, ZIP). Pasting or dropping into a section you're editing inserts the image or a link right there. Images, PDFs (zoom, page jumps, working links, Ctrl+F), video and audio open in the built-in viewer; documents download, or open in their own app in the desktop app. A link to a video or audio file on its own line plays in the note. |
| YouTube, Vimeo, Loom | Put the link on its own line in a note: it shows a **▶ Play** card that plays right there, from the link's time (`?t=750`, `&t=12m30s`). Clicking such a link anywhere plays it in the viewer. Resources that are videos get **▶ Play here** at their start time, and adding a link as a resource fills in its title, type and start time. Nothing loads from YouTube until you press play. Research and decisions: [docs/MEDIA.md](docs/MEDIA.md). |
| Maths | Write LaTeX: `$a^2+b^2=c^2$` inline, or a display equation between `$$` lines. It renders in notes, in the editor (with a live preview) and in PDF and web page exports. Write `\$` for a plain dollar sign. |
| Links | Web links open in a new tab; `[title](cp-…)` jumps to another checkpoint; links to attachments open the viewer. While editing, Ctrl+click follows a link. |
| Add checkpoints | Toolbar **+ Main checkpoint**, the toolbar above a selected checkpoint, or press **A** (sub-checkpoint) / **N** (next). You type the name right on the map. |
| Edit the map (like draw.io) | **Double-click** (or F2) to rename. Drag a checkpoint's **blue dot** to another checkpoint to say “this needs that first”, or to empty space to add a sub-checkpoint. Click an arrow to remove it. **Drop a checkpoint onto another** to move it under that one; drop it on empty space to place it by hand. **Right-click** anything for its menu. |
| Select several | **Shift+drag** on empty space draws a selection box; **Ctrl+click** (⌘ on a Mac) or **Shift+click** adds or removes one; **Ctrl+A** selects everything. Then drag them together, set their status, or delete them, from the toolbar above them or by right-clicking. |
| Sticky notes | **Note** on the map toolbar (or right-click → Add a sticky note). Double-click to write, drag to move, drag the corners to resize, pick a colour. A note stays next to its nearest checkpoint. |
| Reorganise | Drag on the map or in the outline, **Tab / Shift+Tab** to indent, **Alt+↑/↓** to reorder |
| Work on one part | Select it and press **F** (focus); **O** returns to the overview |
| Write | Click anywhere in a section and type: the cursor goes where you clicked, a Docs-style formatting bar appears (text style, bold, italic, link, lists, and an **Insert** list for image, table, code, maths, quote and divider; in a narrow panel the rest is under **⋯**), it saves as you type and closes when you click elsewhere. `</>` switches to Markdown. The roadmap's title, description and goal are edited the same way. |
| Progress | Set status yourself; learning roadmaps also have “can I explain / apply it?” |
| Find | **Ctrl+K** searches titles and notes across all roadmaps |
| Your toolbars | Arrange the map toolbar and the notes formatting bar yourself: **⋯ → Customise toolbar…** (or right-click either bar, or Ctrl+K). Tick what goes on the bar, put it in order with the arrows, and add extras such as *Expand everything*, *Save the map as an image* or a standalone *Table* button. Whatever isn't on a bar stays in its **⋯** menu; **Restore defaults** puts things back. Saved on this computer for every roadmap. |
| Undo and redo | **Ctrl+Z** undoes, **Ctrl+Y** (or Ctrl+Shift+Z) redoes, also from the map toolbar: renames, statuses, moves, links, deletes, sticky notes and positions. History (per checkpoint) restores any earlier version; deleted items go to Trash |

Progress of a checkpoint = completed sub-checkpoints ÷ all sub-checkpoints at every level below it,
ignoring optional and archived ones. A parent is never completed automatically.

## Working with an agent

Nothing is integrated into the app: the agent simply edits the files in your workspace folder, and the
app shows the result. The everyday loop:

1. **Study or brainstorm** with Claude, ChatGPT or another agent in a chat.
2. At the end say **“wrap up”** (or use **⋯ → Work with an agent → Session prompts** to copy a ready prompt
   for the checkpoint). The agent follows the workflow in `AGENTS.md`:
   - **Session notes go into the checkpoint's My notes**, added below what you already wrote. They use the
     format you ask for (bullets, Q&A, Cornell, “only formulas”…); if you don't say, the agent picks the
     clearest form for what happened.
   - New **takeaways**, **open questions**, **resources** and **sub-checkpoints** are added.
   - If you said you finished or understood something, it *proposes* the status. That waits for your
     one-click OK in Review; explaining something never counts as you learning it.
3. Watch the map update; open **Review** to keep or revert anything.

How each agent reaches the files (**⋯ → Connect your AI**, or Help in the desktop app, shows the same with
your folder's path and a first prompt to copy):

| Agent | How |
|---|---|
| Claude app → Code tab, or Claude Code | Choose the workspace folder. `CLAUDE.md` loads the rules in `AGENTS.md`. |
| Claude app → Cowork | Give Claude the folder when you start a task. |
| Claude chat | Add a file-access desktop extension (Settings → Desktop app → Extensions), allowing only this folder. |
| ChatGPT desktop app → Codex | *Open a folder* and pick the workspace. Codex reads `AGENTS.md`. Same for the Codex CLI. |
| Cursor, VS Code (GitHub Copilot), Windsurf | Open the folder; they read `AGENTS.md`. |
| Gemini CLI | Run `gemini` in the folder; `GEMINI.md` loads `AGENTS.md`. |
| ChatGPT or Claude in a browser | No file access: **Work with an agent → Chat without file access** (copy a brief, paste the reply). |

A subscription alone does not give an agent access to your computer. **⋯ → Work with an agent → Connect
your AI** also gives you a paragraph to paste into a Claude or ChatGPT *Project*, so every chat there knows
the workflow.

What the app guarantees whatever the agent does:

- Agents may **add** to My notes, Key takeaways and What I already know, but never change or delete what
  you wrote there: such edits are put back in the file and wait in Review for your decision. The same
  goes for *In my own words*, *Evidence*, status, understanding and approvals.
- **Approved** checkpoints and branches you **lock** are protected the same way.
- If an agent writes an **old copy** of a file (based on an older `rev`), your newer changes win and the
  agent's conflicting values wait in Review.
- **Deleting** a file that holds your work is undone and held for review; other deletions go to Trash.
- Broken files are reported (in the app and in `INDEX.md`) and never overwritten.
- For big reorganisations agents write a **proposal** (`proposals/*.yaml`) you preview change by change.

No file access (e.g. ChatGPT or Claude on the web, or you only uploaded a copy of a file)? **⋯ → Work
with an agent → Chat without file access** copies a brief; paste the reply in **Review → Paste proposal**.
Session notes arrive as additions to My notes, and you preview everything first.

## Your data, backups and recovery

- Attached images and PDFs are ordinary files in `<roadmap>/attachments/<checkpoint-id>/`, linked from
  your notes with relative paths (they also show in Obsidian or VS Code). Deleted ones go to Trash.
- Everything is in the workspace folder. `roadmaps/` holds your library: ordinary folders that group
  roadmaps (e.g. `roadmaps/Learning/Semester 5/`), and each roadmap is a folder with `roadmap.md`,
  `checkpoints/*.md`, `layout.json` and `proposals/`. `LIBRARY.md` at the top lists them all. You can also
  create and move folders in Explorer or Finder; the app follows. Close the app and the files are still
  readable notes.
- **Autosave** writes atomically (temp file → flush → rename); the status shows *Saved*, *Saving…*,
  *Not saved* (with the reason) or *Offline* (edits are kept in the browser and saved when the server is
  back). Browser storage is only that short-term buffer and remembers view settings; it is never the
  copy of record.
- **History** of every change (yours, agents', imports) is in `.waymark/history/` with full before/after
  text; restore from a checkpoint's History section.
- **Trash** (menu → Trash) restores deleted checkpoints and whole roadmaps.
- **Daily backups**: the first save each day writes `backups/YYYY-MM-DD/<roadmap>.waymark.zip` with
  the roadmap and all its attached images and PDFs (30 days kept); menu → *Back up now* any time.
  Restore one with menu → *Import*; it always comes back as a new roadmap, so nothing is overwritten.
  A `.waymark.zip` is an ordinary zip: `roadmap.waymark.json` plus the `attachments/` folder.
- For off-machine safety put the workspace in OneDrive/Dropbox or `git init` it; everything is text.
- Check a workspace without starting the app: `npm run validate` (or `npm run validate -- "<folder>"`).

If something looks wrong: stop the app (Ctrl+C), copy the workspace folder, then restore from History,
Trash or a backup. Damaged files are kept in `.waymark/broken/` when you choose *Restore* on a problem.

## What works and what's next

Works now: a library of roadmaps in nested folders with colour tabs, nested checkpoints, image and PDF
attachments (drop, paste, add) with a built-in image and PDF viewer, working links, an agent session workflow, auto-laid-out map with manual dragging, outline,
focus/overview, notebook sections with a visual Markdown editor, resources with video timestamps,
statuses + understanding + approval, progress, autosave and offline queue, live agent edits with guard
rules, review inbox, proposals, conflict detection, history/undo/trash, export/import, templates,
maths (LaTeX via KaTeX) in notes, editor and exports, daily full backups with attachments, export to PDF,
web page, Markdown, PNG, OPML and backup, import from backups, Markdown outlines and OPML, search,
keyboard shortcuts, light/dark themes, small screens. 68 automated tests cover the file format, change
engine, guard rules, conflicts, review, trash, history, folders (including folders moved outside the app),
export formats, maths, sticky notes, outline import, attachments and zip backups (including blocked path tricks), agent
session notes and keeping agent formatting when you edit.

Not yet (by design for v1): accounts, multi-person collaboration, cloud sync, built-in AI, an MCP server
(file access already covers Claude), video or audio files, custom field profiles in the UI,
cross-roadmap links, macOS testing of the desktop app (see [docs/PLATFORMS.md](docs/PLATFORMS.md)), moving a whole
folder into another folder from the app (rename works; move folders in your file manager).

## Licence of dependencies

All runtime dependencies are open source: React, React Flow (@xyflow/react), d3-hierarchy, Milkdown,
react-arborist, Radix UI, cmdk, sonner, lucide, Tailwind CSS, Hono, chokidar, zod, yaml, jsdiff, nanoid,
micromark/mdast (Markdown), html-to-image (map PNG), react-pdf (MIT) with Mozilla pdf.js (Apache-2.0),
KaTeX (MIT, maths), fflate (MIT, zip backups), htmlparser2 (MIT, link titles), IBM Plex fonts (OFL). The desktop app adds Electron and electron-updater (MIT; its shell and release workflow follow Actual Budget's MIT-licensed desktop app). Waymark makes no network requests on its own. It goes online only for the desktop app's update check (GitHub Releases, can be turned off under Help), a YouTube/Vimeo/Loom video you press play on, and the title of a link you add as a resource.
