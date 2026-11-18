# Waymark data format (schema `waymark/1`)

Everything is plain text in one folder (the *workspace*). Humans, the app and agents all edit the same
files. Identity is always the `id`, never the file name or position, so roadmaps and folders can be moved
or renamed in the app or in Explorer/Finder without losing anything. Folder names must be valid on
Windows and macOS: no `< > : " / \ | ? *`, no leading dot, no trailing dot or space, no reserved names
like `CON`.

```
workspace/
  AGENTS.md, CLAUDE.md          instructions for agents (generated once; edit freely)
  LIBRARY.md                    generated, read-only list of every folder and roadmap
  roadmaps/                     the library: plain folders group roadmaps, up to 4 levels deep
    Learning/                   a folder (no roadmap.md inside)
      Semester 5/               a nested folder
        ai-syllabus/            a roadmap = a folder that contains roadmap.md
    <slug>/                     a roadmap at the top level
  (inside every roadmap folder)
    roadmap.md                  settings + overview
    INDEX.md                    generated, read-only outline (ids, status, files, problems)
    layout.json                 optional map layout: manual offsets and sticky notes (below)
    checkpoints/<slug>.md       one checkpoint per file
    attachments/<checkpoint-id>/  images (png jpg gif webp avif bmp svg) and PDFs, up to 50 MB each
    proposals/*.yaml|json       changesets waiting for review
  templates/*.json              structure templates (bundle format, format: waymark-template)
  backups/YYYY-MM-DD/*.waymark.zip   daily full backups (bundle + attachments), last 30 days
  .waymark/                     app data: history/*.jsonl, review.json, trash/, archive/, broken/
```

A `<slug>` is made from the title when the app creates the folder or file: letters, marks and digits of
any script are kept (`मशीन-लर्निंग`, `机器学习入门`), Latin accents are simplified (`café` → `cafe`),
everything else becomes `-`, at most 60 characters, and names Windows reserves (`con`, `nul`, `com1`…)
get `-1`. Only the `id` identifies anything, so files you or an agent name differently are fine.

## roadmap.md

```markdown
---
schema: waymark/1
id: rm-x7k2p9qa
title: Learn Git fundamentals
profile: learning          # learning | general
description: One line.
agentAccess: review        # default for outside edits: review | direct
color: teal                # optional library tab colour: yellow orange red pink purple blue teal green gray
created: 2026-11-15T09:00:00.000Z
rev: 3
---
Overview, goal and context (Markdown). Agents read this first.
```

## Checkpoint file

Front matter (YAML) + notebook sections (top-level `#` headings with fixed names; any `##`+ inside).

| Field | Type | Who changes it | Notes |
|---|---|---|---|
| `id` | string | set once | `cp-` + 8 random `[a-z0-9]` recommended; never change |
| `title` | string | anyone | |
| `parent` | id \| omitted | anyone (agents: prefer proposals) | omitted = main checkpoint |
| `order` | number | anyone | position among siblings; decimals allowed |
| `summary` | string | anyone | 1–2 sentences |
| `status` | string | **human** | profile statuses (below); common aliases like `done`, `todo` are accepted |
| `understanding` | `not-yet` \| `can-explain` \| `can-apply` | **human** | learning profile |
| `approved` | bool | **human** | approved content is protected from outside edits |
| `optional` | bool | anyone | optional / alternative path, excluded from progress |
| `archived` | bool | **human** | hidden from the map, excluded from progress |
| `agentAccess` | `review` \| `direct` \| `locked` | **human** | override for this branch |
| `prerequisites` | id[] | anyone | checkpoints this one requires |
| `completion` | string | anyone | "done when…" |
| `resources` | list | anyone | `{title, url, kind?, start?, note?}`; kind ∈ article, video, book, course, docs, tool, other; `start` like `"12:30"` |
| `rev` | int | **app** | version counter; editors keep the value they read |
| `updated` | ISO time | app | |
| other keys | any | anyone | preserved as-is |

Sections (profile decides which are shown; content in any known section is always kept):

| Heading | key | Owner | general | learning |
|---|---|---|:-:|:-:|
| Objectives | `objectives` | shared | | ✓ |
| Content | `content` | shared | ✓ | ✓ |
| What I already know | `known` | human | | ✓ |
| What I need to learn | `toLearn` | shared | | ✓ |
| Practice | `practice` | shared | | ✓ |
| My notes | `notes` | human | ✓ | ✓ |
| Key takeaways | `takeaways` | human | ✓ | ✓ |
| In my own words | `ownWords` | human | | ✓ |
| Evidence | `evidence` | human | | ✓ |
| Open questions | `questions` | shared | ✓ | ✓ |

Text before the first known heading is treated as Content. Code fences are respected when splitting.

Statuses: general = `not-started`, `in-progress`, `needs-review`, `complete`; learning =
`not-started`, `learning`, `practising`, `needs-review`, `complete`.

## layout.json (the map)

Written by the app; agents should usually leave it alone. Both parts are optional.

```json
{
  "schema": "waymark-layout/1",
  "offsets": { "cp-k3x9a2mf": { "dx": 40, "dy": -12 } },
  "notes": [
    { "id": "note-1a2b3c4d", "text": "Ask in class: rebase vs merge?", "color": "yellow",
      "anchor": "cp-k3x9a2mf", "dx": 280, "dy": -8, "w": 208, "h": 120 }
  ]
}
```

`offsets` move a checkpoint (and its branch) away from its automatic position. `notes` are sticky notes:
plain text up to 5000 characters, `color` one of yellow, pink, blue, green, purple, size `w`×`h` in map
units. A note is placed at `dx`/`dy` from its `anchor` checkpoint so it stays beside it when the map
re-arranges; it is hidden while that checkpoint is collapsed or in Trash. `anchor: null` places it from the
map origin. At most 300 notes; anything invalid is corrected on load.

## Rules for edits made outside the app

| Change | Result |
|---|---|
| shared fields/sections, not approved, not locked | applied; listed in Review (unless the branch is `direct`) |
| human-owned field or section | held: file restored, change waits in Review |
| approved checkpoint / `locked` branch | held |
| file written with a `rev` lower than current | three-way merge per field using History; both-changed fields held as conflicts |
| new file | added as draft, status not-started; human-owned values held |
| file deleted, checkpoint has human content or children | held: file restored |
| file deleted otherwise | moved to Trash, listed in Review |
| unparseable file / changed id / duplicate id | reported (app + INDEX.md); file left untouched |

## Attachments and links

Files attached to a checkpoint live in `<roadmap>/attachments/<checkpoint-id>/` and are referenced from any
section with paths relative to the checkpoint file, so other Markdown tools display them too:

```markdown
![Branch diagram](../attachments/cp-k3x9a2mf/branch%20diagram.png)
[Week 3 slides](../attachments/cp-k3x9a2mf/slides.pdf)
[Merge conflicts](cp-q1w2e3r4)        ← a link to another checkpoint, by id
```

Encode spaces and brackets in paths (`%20`, `%28`, `%29`). The app shows images inline, opens images,
PDFs, video and audio in its viewer, and follows checkpoint links; other links open in a new tab. Exports
embed attached images, so a saved web page or PDF contains them.

| Kind | Extensions | Limit | In the app |
|---|---|---|---|
| Image | png jpg jpeg gif webp avif bmp svg | 50 MB | inline and in the viewer |
| PDF | pdf | 50 MB | viewer (pdf.js) |
| Video | mp4 m4v mov webm ogv | 500 MB | viewer; a link on its own line plays in the note |
| Audio | mp3 m4a aac wav ogg oga opus flac | 500 MB | viewer; a link on its own line plays in the note |
| Document | txt md csv json ipynb doc docx xls xlsx ppt pptx odt ods odp rtf epub zip | 50 MB | download; *Open* in the desktop app hands it to the system's app |

Other types are refused. Documents are always served as downloads with a sandbox policy, never shown in
the page. Daily backups and `.waymark.zip` exports leave video and audio out (they stay in the folder).

**Online videos.** A YouTube, Vimeo or Loom link standing alone on its line renders as a *Play* card; the
provider's player loads only when it is pressed (`youtube-nocookie.com`, Vimeo `dnt=1`). Start times come
from the link (`t=750`, `t=12m30s`, `#t=1:30`) or a resource's `start`. The Markdown stays a plain link.

## Maths

Sections may contain LaTeX, rendered with KaTeX in the app and in PDF and web page exports:

```markdown
The norm is $\lVert x \rVert_2 = \sqrt{\sum_i x_i^2}$.

$$
\nabla f(x) = 0
$$
```

`$…$` is inline; a `$$` block on its own lines is a display equation. Write `\$` for a literal dollar sign.
A typo shows in red instead of breaking the page. Markdown export keeps the LaTeX as written. A web page
downloaded from Export carries KaTeX's stylesheet and fonts inside it, so maths renders offline.

## Session notes from agents

When an agent wraps up a study or brainstorming session it adds an entry to **My notes**, below the
existing text, starting with `### Session YYYY-MM-DD: <topic>`, in the format the human asked for, or the
clearest one for the session when they didn't. Adding below existing text is applied (and listed in
Review); changing or removing existing text is held. The same applies to Key takeaways and What I already
know. Headings such as `# Session log` or `# Study log` are read as part of My notes. See the *Workflows*
section of `AGENTS.md` for the full procedure.

## Changeset (proposal) — `waymark-changeset/1`

YAML or JSON, in `roadmaps/<slug>/proposals/` or pasted into Review.

```yaml
schema: waymark-changeset/1
roadmap: rm-x7k2p9qa          # optional
title: Short title
author: claude
summary: Why.
changes:
  - { op: add, id: cp-new00001, parent: cp-…, after: cp-…, title: …, summary: …, optional: false,
      prerequisites: [cp-…], completion: …, sections: { content: "…" }, resources: [ … ] }
  - { op: update, id: cp-…, rev: 7, set: { title: …, summary: …, sections: { content: "…" }, resources: [ … ] } }
  - { op: move, id: cp-…, parent: cp-… | null, after: cp-… | null }   # after omitted = last, null = first
  - { op: delete, id: cp-… }                                           # whole branch → Trash
  - { op: link,   id: cp-dependent, prerequisite: cp-required }
  - { op: unlink, id: cp-dependent, prerequisite: cp-required }
```

`update` may also carry `append: { notes: "…", takeaways: "…" }`, which adds text below a section's
existing text (separated by a blank line) without retyping it. Use it for session notes.
`set` accepts `title, summary, completion, optional, prerequisites, resources, sections, status,
understanding, approved, archived, agentAccess`; the last five are flagged in the preview as yours and
are not pre-selected. Section keys may be keys or headings (`"My notes"`). Invalid changes are listed
and skipped; valid ones can be applied individually. The app's own edits use the same operations.

## Export bundle — `waymark-bundle`

```json
{
  "format": "waymark-bundle",
  "schemaVersion": 1,
  "exportedAt": "…",
  "generator": "waymark",
  "roadmap": { "id": "rm-…", "title": "…", "profile": "learning", "description": "…",
               "agentAccess": "review", "created": "…", "overview": "…" },
  "checkpoints": [ { "id": "cp-…", "title": "…", "parent": null, "order": 1, "summary": "…",
                     "status": "…", "understanding": "not-yet", "approved": false, "optional": false,
                     "archived": false, "agentAccess": null, "prerequisites": [], "completion": "",
                     "resources": [], "sections": { "content": "…" } } ],
  "layout": { "schema": "waymark-layout/1", "offsets": {} }
}
```

Import validates every checkpoint with the same rules as files, reports what it skipped, and always
creates a new roadmap. Templates use the same shape with `"format": "waymark-template"`.

## Full backup — `.waymark.zip`

A plain zip holding `roadmap.waymark.json` (the bundle above) and the roadmap's attachments at their
usual paths:

```
roadmap.waymark.json
attachments/<checkpoint-id>/<file>
```

Importing restores attachments only for checkpoints in the bundle, only with allowed file types and
sizes, and only at exactly `attachments/<checkpoint-id>/<file>`. Anything else (other files, other paths,
`..` tricks) is skipped and listed as a warning. Images and PDFs are stored uncompressed inside the zip.

**Migrations:** `schemaVersion` (bundles) and `schema` (roadmap.md, changesets) name the version.
`migrateBundle()` in `src/shared/bundle.ts` upgrades step by step (`v1 → v2 → …`); files written by a
newer version are refused with a clear message instead of being misread.

## History log

`.waymark/history/<roadmap-id>.jsonl`, one JSON object per line:
`{id, t, roadmapId, cp, title, source: app|external|proposal|import|restore|review|system, kind:
create|update|delete, before, after, note?}` with full file text. Typing in the app is coalesced per checkpoint
into one entry per 15 seconds (flushed on shutdown). The log is the baseline for detecting edits made while the app was closed.

## Local HTTP API (127.0.0.1 only)

Requests from other websites are refused (Origin and Host checks). JSON in and out.

| Method & path | Purpose |
|---|---|
| `GET /api/state` | workspace path, roadmap summaries, problems |
| `GET /api/roadmaps/:id` | full roadmap (meta, checkpoints, layout, files, problems) |
| `POST /api/roadmaps` | create `{title, profile, description?, template?}` |
| `PATCH /api/roadmaps/:id` | `{title?, description?, overview?, profile?, agentAccess?}` |
| `DELETE /api/roadmaps/:id` | move roadmap to Trash |
| `POST /api/roadmaps/:id/ops` | `{ops: [...]}` same operations as changesets; `update` may carry `expect` for compare-and-set |
| `PUT /api/roadmaps/:id/layout` | `{offsets?, notes?}`; a part left out stays as it is |
| `GET /api/roadmaps/:id/history?cp=` · `POST …/history/restore` | history, `{entryId, which: before\|after}` |
| `GET /api/library` | `{folders, roadmaps}` for the library sidebar |
| `POST /api/folders` · `PATCH /api/folders` · `DELETE /api/folders?path=` | create `{parent, name}`, rename `{path, name}`, delete (empty only) |
| `POST /api/roadmaps/:id/move` | `{folder}` (`""` = top level) |
| `GET /api/roadmaps/:id/export?format=` | `zip` (full backup) · `json` (data only) · `md` · `html` · `pdf` (HTML that opens the print dialog) · `opml`; options `branch=<id>`, `personal=0`, `archived=1`; `download=1` on `html` makes a self-contained file |
| `POST /api/import?folder=` | a `.waymark.json` bundle |
| `POST /api/import/zip?folder=` | a `.waymark.zip` full backup as the body; returns `{roadmapId, warnings, attachments}` |
| `POST /api/import/markdown` | `{text, title?, profile?, folder?}`: headings and lists become checkpoints |
| `POST /api/roadmaps/:id/attachments?cp=&name=` | file bytes as the body, streamed to disk; returns `{name, path, markdownPath, kind, size}` |
| `DELETE /api/roadmaps/:id/attachments?path=` | moves an attachment to Trash |
| `GET /api/roadmaps/:id/files/attachments/…` | serves an attached file with range requests (`206`) for seeking; `?download=1` to download (documents always download) |
| `POST /api/link-info` | `{url}` → `{title?, site?, kind?, start?}` for a resource; YouTube/Vimeo via oEmbed, other pages via their title tags (5 s timeout, first 1 MB) |
| `GET /api/review` · `POST /api/review/:itemId` | `{action: keep\|revert\|apply\|discard, fields?}` |
| `POST /api/roadmaps/:id/proposals` | paste `{text}` |
| `POST /api/roadmaps/:id/proposals/:name/apply` · `/reject` | `{indexes}` |
| `POST /api/roadmaps/:id/brief` | copy-for-AI text `{checkpointId?, request}` |
| `GET /api/search?q=` | search all roadmaps |
| `GET /api/trash` · `POST /api/trash/:id/restore` · `DELETE /api/trash/:id` | trash |
| `POST /api/backup` · `GET /api/templates` · `POST /api/roadmaps/:id/template` | backups, templates |
| `GET /api/events` | server-sent events: `roadmap`, `roadmaps`, `review` |
