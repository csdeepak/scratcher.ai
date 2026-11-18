# Media in Waymark: research and decisions

*How PDFs, links, YouTube and other videos, audio and documents are attached, shown and played.
Researched November 2026 against the versions in `package.json` (React 19.3, Electron 45.3, Milkdown
Crepe 7.23, Node 22+), following the project rule: find and reuse proven open-source work first, build
only what is missing.*

## 1. What people need

| Need | Example |
|---|---|
| Keep a PDF with the topic and read it in the app | Lecture slides on "Linear regression" |
| Keep a web link, with a readable title | A tutorial or documentation page |
| Watch a YouTube lecture from the right minute, without leaving the notes | `https://youtu.be/…?t=750` |
| Keep their own recordings | A screen recording, a voice memo, a class recording |
| Keep other study files | A Jupyter notebook, a Word or PowerPoint file, a CSV dataset |
| Paste or drop any of these and have it just work | Screenshot, PDF, MP4 or MP3 dropped onto a page |

## 2. Criteria

1. **Plain Markdown stays plain.** Agents and other editors (Obsidian, VS Code) must read and write it:
   no custom syntax required.
2. **Privacy.** Waymark makes no network requests on its own. Anything online loads only when the user
   asks (presses play, asks for a title).
3. **Offline first.** Local files always work; online media degrades to a clear link.
4. **Security.** Nothing from an attachment or embed may run in Waymark's own page; the desktop window
   stays sandboxed; no executable files are opened.
5. **Fit with the current stack and size.** Works with React 19, Electron 45's Chromium, the Crepe
   editor and the Node server; prefer small, maintained, permissively licensed packages.

## 3. Options considered

### Playing YouTube, Vimeo and Loom

| Option | Version / licence | Finding |
|---|---|---|
| react-player | 3.4.0, MIT, React 19 ok | One component for many sites, but it now installs eight player packages (Mux, HLS, DASH, Twitch, TikTok, Spotify…), far more than needed. |
| Vidstack (`@vidstack/react`) | 1.15.7, MIT | A full player UI; heavy for "play this lecture". |
| lite-youtube-embed / `@justinribeiro/lite-youtube` | 0.4.0 Apache-2.0 / 1.9.0 MIT | The well-known *facade* pattern: show a placeholder, load YouTube's player only on click. |
| The providers' official embed players | YouTube IFrame embed, Vimeo player, Loom embed | Free, maintained by the providers, support start times. |
| How others do it | Outline turns a pasted YouTube link into a player; Logseq uses `{{video url}}` with `#t=` timestamps; Obsidian embeds via plugins or HTML | A plain link that *renders* as a player (Outline) keeps files portable; macros (Logseq) need custom syntax. |

YouTube now refuses embeds without a referrer (its "Error 153"): the iframe must send at least the
page's origin (`referrerpolicy="strict-origin-when-cross-origin"`) from an `http(s)` page. Waymark's
page is `http://127.0.0.1:<port>`, so this works in the browser and in the desktop app.

**Decision:** official embed players in an `iframe`, loaded **only when the user presses play** (the
lite-youtube-embed facade pattern, no thumbnail fetched beforehand), using `youtube-nocookie.com` and
Vimeo's `dnt=1`. Start times come from the link (`t=`, `start=`, `#t=`) or the resource's timestamp.
**No new package.**

### Video and audio files

| Option | Finding |
|---|---|
| Vidstack, media-chrome 4.19 (MIT) | Custom controls and skins: not needed. |
| HTML5 `<video>` / `<audio>` | Built into Chromium; Electron ships the H.264/AAC codecs, so MP4, MOV (H.264), WebM, MP3, M4A, WAV, OGG, FLAC play in both the browser version and the desktop app. Seeking needs HTTP range requests. |

**Decision:** the browser's own players. The server gains **range requests** (`206 Partial Content`)
and **streams uploads to disk** instead of holding them in memory. Limit: 500 MB per video or audio
file (50 MB for everything else). Daily backups and backup exports **leave video and audio out** (they
stay in the folder) so backups stay small.

### Link titles ("hyperlink attachments")

| Option | Version / licence | Finding |
|---|---|---|
| open-graph-scraper | 6.13.0, MIT | Pulls in cheerio, undici and iconv-lite. |
| metascraper | 5.58.7, MIT | Plugin system, cheerio; large. |
| unfurl.js | 6.4.0, ISC | Uses node-fetch 2 and htmlparser2. |
| oEmbed endpoints | YouTube, Vimeo | Official, keyless JSON with the real title and author. |
| htmlparser2 | 12.0.0, MIT | The small, fast parser underneath cheerio and unfurl.js; no network code. |

**Decision:** oEmbed for YouTube and Vimeo, otherwise read `og:title` / `<title>` with **htmlparser2**,
fetched with Node's built-in `fetch` (5 s timeout, first 1 MB only). It runs **only when the user adds
a link as a resource** and the title is empty. The resource's type (video, docs, course, …) and start
time are guessed from the address.

Showing whole web pages *inside* Waymark was rejected: most sites forbid framing (`X-Frame-Options`),
and the desktop window refuses webviews for security. Links open in the normal browser, as before.

### Other documents

**Decision:** attach common study files: Word, Excel, PowerPoint, OpenDocument, text, Markdown, CSV,
JSON, Jupyter notebooks, EPUB and ZIP. They are always **downloaded, never shown inside the page**
(served as attachments with a sandbox policy). In the desktop app, **Open** hands them to the system's
app for that type; only these document types can be opened that way, never programs or scripts.

## 4. How it works for the user

| Paste or drop… | Stored as | Shown as |
|---|---|---|
| Image | `attachments/<checkpoint>/…` + `![name](…)` | The image (as before) |
| PDF | attachment + `[name.pdf](…)` | Built-in PDF viewer (as before) |
| Video or audio file | attachment + `[name.mp4](…)` | A player in the note when the link is on its own line; the viewer otherwise |
| Word, Excel, notebook… | attachment + `[name.docx](…)` | Download, or **Open** in the desktop app |
| YouTube / Vimeo / Loom link | the link as typed | On its own line: a "▶ Play" card that loads the player in place. Anywhere: clicking it plays in the viewer, at its timestamp |
| Any link added under **Resources** | `resources:` in the checkpoint | Title filled in from the page; videos get **▶ Play here** at their start time |

## 5. Security and privacy summary

* Attachments other than images, PDFs, video and audio are never rendered in Waymark's page; SVGs and
  unknown types carry a sandbox Content-Security-Policy; all carry `nosniff`.
* Embeds are third-party iframes on their own origin, created only on click; links they open go to the
  system browser.
* Network use: the update check (desktop), a video you press play on, and a title lookup you trigger.
  Nothing else.

## 6. Not now

Google Docs/Slides embeds (need the user's Google sign-in inside the frame), tweets and social posts,
Spotify and podcasts, automatic transcripts, thumbnails before play (each would be a network request
when a page is opened). Revisit if users ask.
