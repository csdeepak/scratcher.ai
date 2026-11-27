# Try Waymark (for testers)

Waymark turns a goal (a subject, a course, a project) into a map of checkpoints. Each checkpoint is a
notebook page for your notes, links, PDFs and videos. Your AI (Claude, ChatGPT/Codex, Gemini…) can write
into the same notes. Everything stays on your computer as plain files. Free, no account.

**I'd love your honest feedback**: what helped, what confused you, what you'd change. It takes about
15 minutes to try and 3 minutes to tell me.

## 1. Install (2 minutes)

Download from the **[latest release](https://github.com/csdeepak/scratcher.ai/releases/latest)**:

| Computer | File | Notes |
|---|---|---|
| Windows 10/11 | `Waymark-Setup-<version>.exe` | Windows warns about an "unknown publisher" (the app isn't code-signed yet): click **More info → Run anyway**. Installs for your user only, no admin needed. |
| Mac (Apple chip, M1 and later) | `Waymark-<version>-mac-arm64.dmg` | Not tested on Mac yet. If macOS says it can't verify the app, right-click the app → **Open** → **Open**. |
| Mac (Intel) | `Waymark-<version>-mac-x64.dmg` | Same as above. |
| Linux | `Waymark-<version>-linux-x86_64.AppImage` | Make it executable (`chmod +x`), then run it. |

The app updates itself when a new version comes out.

## 2. First start (1 minute)

1. Waymark asks **where your notes should live**. The suggested folder is fine.
2. **Connect your AI** shows how to point Claude, ChatGPT/Codex or others at that folder. You can skip
   this and come back later (Help → Connect your AI).

## 3. A 15-minute tour

Try as many as you like:

- [ ] Open the example roadmap *Learn Git fundamentals*. Click checkpoints on the map; use the outline.
- [ ] Make your own roadmap for a real subject (**New roadmap → Learning**). Add 3 checkpoints on the
      map (select one, press **A** for a sub-checkpoint, **N** for the next one).
- [ ] Write notes in a checkpoint. Paste a screenshot, drop a PDF, add a maths formula like `$a^2+b^2=c^2$`.
- [ ] Put a YouTube lecture link on its own line in your notes and press ▶ Play.
- [ ] Set a checkpoint's status and "can I explain it?" and watch the progress bar.
- [ ] **With an AI** (if you have Claude Code, Codex, Cursor or similar): open **⋯ → Work with an agent**,
      pick a checkpoint, copy **Start a session**, study with the AI, then copy **Wrap up** and watch your
      notes appear. Open **Review** to keep or undo what it wrote.
- [ ] Export a roadmap as PDF (**⋯ → Export**).

## 4. Tell me what you think

In the app: **⋯ → Send feedback…** (or Help → Send feedback). It opens a short form; the version is
filled in for you. You need a free GitHub account, and what you write there is public, so leave private
notes out.

- [Give feedback](https://github.com/csdeepak/scratcher.ai/issues/new?template=1-feedback.yml) (3 minutes)
- [Report a problem](https://github.com/csdeepak/scratcher.ai/issues/new?template=2-bug.yml)
- [Suggest an idea](https://github.com/csdeepak/scratcher.ai/issues/new?template=3-idea.yml)

No GitHub account? Just message me what you liked, what confused you, and one thing you'd change.

## Your data

Your notes are ordinary Markdown files in the folder you chose; Waymark never uploads them. It goes
online only to check for updates, to play a video you press play on, and to read the title of a link you
add as a resource. To uninstall on Windows: Settings → Apps → Waymark (your notes folder stays).
