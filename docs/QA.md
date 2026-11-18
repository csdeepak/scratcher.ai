# Quality checks

Waymark is for learners and makers of every kind: people who use a keyboard or a screen reader, people
with low vision or motion sensitivity, people on phones and small laptops, people who write in Hindi,
Kannada, Chinese or Arabic, and people with very large roadmaps. These checks keep the app working for
them. Run them before a release; the automated ones also catch regressions.

Always test on a throwaway workspace, never your own notes:

```bash
npm run serve -- --port 4318 --workspace .waymark-test
```

## Automated

| Check | Command | What it covers |
|---|---|---|
| Unit and engine tests | `npm test` | File format, guard rules, history, attachments, workspace folders, file names in every script |
| Accessibility | `npm run qa:a11y` (test server running; known, reviewed exceptions are listed at the top of the script) | [axe-core](https://github.com/dequelabs/axe-core) (MPL-2.0) on 12 screens and dialogs, light and dark themes, phone width: WCAG 2.2 A/AA and best practices. Writes `qa-a11y-report.json`; fails on serious or critical problems |
| Types | `npm run typecheck` | |
| Desktop app | `WAYMARK_SMOKE_TEST=1 …` (see [PLATFORMS.md](PLATFORMS.md)) | The packed app starts, its welcome page loads, maths, PDF fonts, backups and the update check respond |

## By hand, per kind of user

**Keyboard only.** Tab from the top: the first stop is *Skip to main content*. Every stop shows a
focus ring. The map is one Tab stop (the selected checkpoint, or the first); arrow keys move between
checkpoints and focus follows; Enter opens a checkpoint, Enter again renames it. Tab and Shift+Tab
indent or outdent only the selected checkpoint: Escape, then Tab, leaves the map. Buttons, menus and
the outline keep their own keys (Enter on a button presses it, even with a checkpoint selected).
Closing any dialog or drawer puts focus back where it was.

**Screen reader.** Landmarks: header, *Your roadmaps* or *Roadmap map* (main), *Details* (aside). One
h1 per page, an h2 per panel, h3 per section. Status icons are named ("Complete", "In progress"…),
the editor is named after its section, and the map describes its keys.

**Low vision.** All text is at least 4.5:1 against its background in both themes (the faint grey
is `#6a655e` light, `#97928a` dark). Check at 200% zoom (a 720×450 window): the panel takes the
full width and nothing overlaps.

**Motion sensitivity.** With *reduce motion* on in the system, CSS transitions and the map's own
pan and zoom animations are instant.

**Phones and small windows.** At 375 px wide nothing scrolls sideways, icon buttons keep at least
24 px, and the details panel covers the map instead of squeezing it.

**Other languages.** Roadmap folders and checkpoint files keep their titles' letters in every script
(`मशीन-लर्निंग`, `机器学习入门`, `تعلم-الآلة`); Latin accents are simplified (`café` → `cafe`); names
Windows reserves (`con`, `nul`, `com1`…) get `-1`. Search finds words in any script. Text written in
Arabic, Hebrew or Urdu runs right to left in titles, the outline, the map and notes (`dir="auto"`),
and exports download with the real name (RFC 6266 `filename*`).

**Large roadmaps.** `npm run gen:large -- 1000` (move the file out of `examples/` afterwards), then
import it: about 5 s on Windows. Opening it takes about 0.1 s; with everything expanded only the
checkpoints on screen are drawn, and the map area keeps a Tab stop when the selected one is off screen.

**Media.** Attach a short video, an audio file and a CSV: the video plays and seeks in the viewer (the
server answers range requests with `206`), the audio plays, the CSV only downloads. A YouTube link on its
own line in a note shows a *Play* card and nothing loads from YouTube before you press it; then it plays
from the link's time. Adding `https://youtu.be/<id>?t=2m` as a resource fills in the title, *video* and
`2:00`, and **▶ 2:00** plays it in the viewer.

**First-time users.** The desktop app's welcome page checks the folder as you type; Connect your AI
explains each agent with the folder's path filled in.
