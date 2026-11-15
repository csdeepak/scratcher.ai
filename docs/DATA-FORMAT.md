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
    layout.json                 optional manual offsets {"offsets": {"cp-…": {"dx": 40, "dy": -12}}}
    checkpoints/<slug>.md       one checkpoint per file
    proposals/*.yaml|json       changesets waiting for review
  templates/*.json              structure templates (bundle format, format: waymark-template)
  backups/YYYY-MM-DD/*.waymark.json
  .waymark/                     app data: history/*.jsonl, review.json, trash/, archive/, broken/
```

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
| `PUT /api/roadmaps/:id/layout` | `{offsets}` |
| `GET /api/roadmaps/:id/history?cp=` · `POST …/history/restore` | history, `{entryId, which: before\|after}` |
| `GET /api/library` | `{folders, roadmaps}` for the library sidebar |
| `POST /api/folders` · `PATCH /api/folders` · `DELETE /api/folders?path=` | create `{parent, name}`, rename `{path, name}`, delete (empty only) |
| `POST /api/roadmaps/:id/move` | `{folder}` (`""` = top level) |
| `GET /api/roadmaps/:id/export?format=` | `json` (backup) · `md` · `html` · `pdf` (HTML that opens the print dialog) · `opml`; options `branch=<id>`, `personal=0`, `archived=1` |
| `POST /api/import?folder=` | a backup bundle |
| `POST /api/import/markdown` | `{text, title?, profile?, folder?}`: headings and lists become checkpoints |
| `GET /api/review` · `POST /api/review/:itemId` | `{action: keep\|revert\|apply\|discard, fields?}` |
| `POST /api/roadmaps/:id/proposals` | paste `{text}` |
| `POST /api/roadmaps/:id/proposals/:name/apply` · `/reject` | `{indexes}` |
| `POST /api/roadmaps/:id/brief` | copy-for-AI text `{checkpointId?, request}` |
| `GET /api/search?q=` | search all roadmaps |
| `GET /api/trash` · `POST /api/trash/:id/restore` · `DELETE /api/trash/:id` | trash |
| `POST /api/backup` · `GET /api/templates` · `POST /api/roadmaps/:id/template` | backups, templates |
| `GET /api/events` | server-sent events: `roadmap`, `roadmaps`, `review` |
