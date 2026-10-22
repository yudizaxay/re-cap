# re:cap: project handoff

Written 22 Oct 2026. Give this file to any AI or person to continue the work. It says what exists, why it is built this way, what was tested, and what is left.

## 1. What this is

**re:cap** is a Chrome extension (Manifest V3, plain JavaScript, no build step) that records a meeting running in a browser tab, then makes a transcript, an AI summary and action items. Free for life, no servers, recordings stay in the browser. Built for the user (Akshay Singh, GitHub `yudizaxay`, site axaysingh.com).

It started as a request to "create tldv.io using REA" (REA = the reverse-engineering toolkit at github.com/morluto/rea). REA was used only to inspect tldv.io's page structure and styles. The extension itself is original.

## 2. Where everything is

The extension now lives in the git repo `~/Documents/GitHub/re-cap` (this folder; it replaces `meet-recorder-extension/` below). The other paths are under `~/Documents/`.
| Path | What |
|---|---|
| `meet-recorder-extension/` | **The main project.** Load this folder as an unpacked extension. This is what goes to GitHub. |
| `recap-store/` | Chrome Web Store material: `privacy-policy.md` (same text as `PRIVACY.md` in this repo; the duplicate `privacy-policy.md` was removed from the repo), `store-listing.md` (listing text, permission justifications, data-usage answers, asset checklist), `recap-0.1.0.zip` (upload package), this file. |
| `tldv/` | React/Vite clone of the tl;dv marketing homepage (side project, not part of re:cap, do not publish it as tl;dv). |
| `tldv-recorder/` | Electron desktop recorder (Mac/Windows), an earlier alternative. Works on files but was less used; has the macOS Screen Recording permission problem in dev mode. |

Rebuild the Store zip after any change:

```
cd ~/Documents/GitHub/re-cap
rm -f ~/Documents/recap-store/recap-0.1.0.zip
zip -qr ~/Documents/recap-store/recap-0.1.0.zip . -x "*.DS_Store" "README.md" "PRIVACY.md" "store-listing.md" "HANDOFF.md" "LICENSE" "docs/*" ".github/*" ".gitignore" ".git/*"
```

## 3. File map of the extension

- `manifest.json`: MV3. Permissions: tabCapture, desktopCapture, offscreen, activeTab, storage, unlimitedStorage. Hosts: api.groq.com, api.openai.com, api.anthropic.com, generativelanguage.googleapis.com. Optional hosts (https, localhost) are requested at runtime for a Custom server. Content scripts on meet.google.com: `hook.js` (world MAIN) and `content.js`.
- `background.js`: service worker. Handles `start`, `stop`, `process`, `state`, `status`, `call-ended`, `get-settings`. `finishRecording()` is shared by popup Stop, call end and tab close; it opens the finished meeting in a new tab once (`openMeeting`).
- `offscreen.js` + `offscreen.html`: the recorder. Uses getUserMedia with tab/desktop stream ids, mixes tab audio + mic with Web Audio, runs two MediaRecorders (a continuous one for playback stored chunk by chunk in IndexedDB `media`; a rotating 20-minute one for transcription stored in `audio`). Also runs transcription and summary. Offscreen pages only have `chrome.runtime`, so settings come from the background (`get-settings`).
- `pipeline.js`: transcription (OpenAI-style `/audio/transcriptions`, `verbose_json`, timestamps) and summary (Anthropic Messages API, or any OpenAI-style `/chat/completions`). Summary tries other available models if one is blocked/retired, and summarises long transcripts in chunks.
- `hook.js`: runs in the Meet page's own JS world. Wraps `RTCPeerConnection` to detect call start/end (debounced 8 s; also wraps `close()` because it fires no event). It does not touch media.
- `content.js`: Meet page bridge. Shows the red "Recording (re:cap)" pill; forwards `call-ended` to the background; posts a **recording notice in the Meet chat** (finds chat toggle/textarea/send button by role and icon text, not by English label; retries; shows a warning toast if it cannot).
- `popup.html/js/css`: toolbar popup. Video source select (this tab / entire screen or window / none), Start/Stop, one-time disclosure + consent box (Web Store policy), mic warning.
- `app.html/js/css`: meetings page (also `options_page`). Home hero, sidebar list, meeting view (player, Summary/Transcript tabs with clickable timestamps, ⋯ menu), Settings dialog (Settings + About tabs), custom confirm dialog, import/export buttons.
- `db.js`: IndexedDB (`meetings`, `audio`, `media`) and settings defaults.
- `io.js`: export/import of meetings as folders using the File System Access API (`meeting.json`, `recording.webm`, `audio-N.webm`, `transcript.md`, `summary.md`). Validates ids on import.
- `about.js`: developer details (name, site, GitHub, sponsor link, bio, avatar) shown in Settings → About. Edit this file to change them.
- `icons/`: `icon-16/32/48/128.png` (toolbar uses the tight, edge-to-edge mark; 128 has Store padding), `logo-mark.svg`, `logo.svg`, `favicon.svg`, `dev.png` (developer avatar, white background).
- `docs/`: landing page (`index.html`, `assets/`, `.nojekyll`; served by GitHub Pages from `main` /docs) and README images (`logo.png` cropped from the user's original logo, three screenshots made from sample data).
- `README.md`, `PRIVACY.md`, `LICENSE` (MIT), `.gitignore`, `.github/FUNDING.yml`.

## 4. Behaviour (current)

1. User opens a meeting tab, clicks the re:cap icon, accepts the one-time notice, picks video source, presses Start.
2. Recording runs: tab audio + mic (+ tab video, or whole screen/window through the desktop picker). Red badge + REC on the icon.
3. On Google Meet: a notice is posted in the call chat (editable text, can be turned off in Settings). When the call ends the recording stops by itself (about 8 s later) and the meeting opens in a new tab. On other sites the user presses Stop.
4. Processing: transcription, then summary. Meeting page updates live (polls every 2 s).
5. Data stays in the browser. Export/Import to folders; Save recording (.webm); Download notes (.md).

## 5. AI providers (Settings → AI provider)

| Preset                    | Transcription                      | Summary                                                          | Keys                                       |
| ------------------------- | ---------------------------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| **Groq (free, default)**  | `whisper-large-v3`                 | `openai/gpt-oss-120b`                                            | one Groq key                               |
| Groq + Gemini (both free) | `whisper-large-v3`                 | `gemini-2.5-flash` via Gemini's OpenAI-compatible endpoint       | Groq + Gemini                              |
| OpenAI + Anthropic (paid) | `whisper-1`                        | `claude-sonnet-5-5`                                              | OpenAI + Anthropic                         |
| Custom                    | any `/audio/transcriptions` server | any `/chat/completions` server, or Anthropic if the URL is blank | asks Chrome for access to the typed origin |

Key facts learned the hard way:

- Groq retired `llama-3.3-70b-versatile`. The user's Groq project also had **all chat models blocked at project level** (403 `model_permission_blocked_project`); a project admin must enable them at console.groq.com/settings/project/limits. Whisper was allowed. The Gemini preset exists as the workaround.
- Hindi transcripts were gibberish with auto-detect; set **Meeting language** (e.g. `hi`) and use `whisper-large-v3`.

## 6. Key decisions and why (do not undo without reason)

- **Auto-record was built, then removed.** Chrome only allows `tabCapture` on a tab the user invoked the extension on (activeTab), so true hands-free video is impossible. Without video the user judged auto-record pointless. What remains: manual Start, and **auto-stop when a Meet call ends** + open the meeting.
- **Chat notice instead of a Meet banner.** Extensions cannot trigger Meet's own recording banner, so other participants were never told. The extension posts a normal chat message from the user's account. Default text: "Heads up: I'm recording this meeting and creating an AI transcript and summary (re:cap). If you'd rather not be recorded, please tell me now." Editable in Settings.
- **One-time disclosure/consent in the popup** replaced the earlier per-call consent checkbox (the user disliked the checkbox; the Web Store user-data policy still requires a prominent disclosure before collection).
- **Native Sponsor card instead of GitHub's iframe**: GitHub refuses to be framed inside an extension page ("refused to connect").
- **No emoji in the UI**: line SVG icons only (the user asked).
- **Custom in-page dialogs** replace `confirm()`/`alert()` (the user disliked "The extension re:cap says").
- **Reply language**: the user writes in Hinglish and wants Hinglish replies.

## 7. Testing status

Tested in real Chrome (headless, mock pages): hook call start/end/blip debounce; chat-notice posting on mock Meet pages (English label, localized icon-only label, no chat, recording before join, custom text); meetings page rendering; delete dialog; About tab; icons. Tested by the user in real Chrome: recording, playback, transcript, summary (with Groq), popup states, import/export UI.

**Not tested on real Google Meet:** call-end auto-stop, the chat notice, the new-tab opening after a call. **Not tested at all:** Microsoft Teams, Zoom (web), Webex, Edge/Brave, the macOS screen-share (entire screen) path end to end, and the one-time consent box after the last change. Unit checks so far were `node --check` on every file plus mock-page tests; there is no automated test suite.

## 8. Known limits

- Other participants are notified only on Google Meet, and only if chat is available.
- Desktop apps: whole-screen mode records the picture; on macOS the other side's voice is not captured (only browser tabs carry call audio).
- Transcription uploads are capped (~25 MB), so audio is split into 20-minute files. Free API tiers have rate limits.
- API keys are stored unencrypted in `chrome.storage.local` (disclosed in the privacy policy).
- Recordings live in IndexedDB; removing the extension or clearing browser data deletes them (hence Export).

## 9. Still to do (in priority order)

1. ~~Put the user's email in `PRIVACY.md`~~ Done (`axayrs@gmail.com`).
2. ~~Add a `LICENSE`~~ Done: MIT, `LICENSE`, © 2026 Akshay Singh (linked from README).
3. Create the GitHub repo and push (commands are in the README / earlier chat). Then set `repo:` in `about.js`, and turn on Pages (Settings → Pages → `main` /docs).
4. Test one real Google Meet call end to end (auto-stop, chat notice, new tab), ideally with a second participant.
5. For the Chrome Web Store: host the privacy policy at a public URL, make 1280×800 screenshots and a 440×280 promo tile from a real recording, $5 developer account + 2-Step Verification, fill the dashboard using `store-listing.md`. Expect a slower manual review (tabCapture, desktopCapture, MAIN-world content script on a Google site).
6. Verify the user owns/licenses the logo and the developer avatar illustration.
7. Optional ideas: speaker labels, keyboard shortcut to start, notice text mentioning video, tests for the pipeline.

## 10. Security note

The user pasted a real Groq API key into the chat during development, and it was used to list/test models. It is **not** stored in any project file (scanned). It should be revoked and replaced at console.groq.com/keys.

## 11. How to continue

- Load: `chrome://extensions` → Developer mode → Load unpacked → this folder. After any edit click reload on the card and refresh the Meet tab.
- Syntax check everything: `for f in *.js; do node --check --input-type=module < $f; done`.
- Useful patterns from this build: UI changes were verified by serving a copy over `python3 -m http.server` with a fake `chrome` object and screenshotting in headless Chrome over the DevTools protocol; call logic was tested with a local two-peer WebRTC page and `--use-fake-device-for-media-stream`. Chrome 137+ ignores `--load-extension` unless `--disable-features=DisableLoadExtensionCommandLineSwitch` is set, and even then loading the extension for automation did not work here.
