# Chrome Web Store: listing and Privacy tab answers for re:cap

## Store listing

**Name:** re:cap
**Summary (max 132 chars):** Record Google Meet, Teams and Zoom calls in your browser, then get a transcript, AI summary and action items. Free.
**Category:** Productivity
**Language:** English

**Detailed description**
> re:cap records a meeting that runs in your browser (Google Meet, Microsoft Teams, Zoom web and other meeting sites) and turns it into a transcript, a summary and a list of action items, without a bot joining.
>
> • Record the Meet tab (video + audio), or your whole screen / a window, plus your microphone
> • On Google Meet, recording stops by itself when the call ends, the meeting opens in a new tab, and a recording notice is posted in the call chat so everyone knows (can be turned off)
> • Works on any meeting site open in a tab; for desktop apps, record your whole screen (the other side's voice is captured only from browser tabs)
> • Transcript with clickable timestamps that jump the video to that moment
> • AI summary: key points, decisions, action items, open questions
> • Works with a free Groq key, or OpenAI / Anthropic / Gemini, or your own OpenAI-compatible server
> • Your recordings stay in your browser. Export and import meetings as normal files
> • Free, with no account, no servers and no ads. You use your own (free) provider key
>
> How it works: open a Meet call, click the re:cap icon, press Start. When the call ends your recording, transcript and summary are ready.
>
> Privacy: re:cap has no servers. To make the transcript, the audio is sent directly from your browser to the AI provider you choose with your own API key. See the privacy policy.
>
> Please tell everyone on the call you are recording, and follow the recording laws that apply to you.
>
> re:cap is an independent project. It is not affiliated with, endorsed by, or sponsored by Google. "Google Meet" is a trademark of Google LLC.

**Privacy policy URL:** [PUBLISH PRIVACY.md and put its public URL here]
**Official/support URL:** https://axaysingh.com (verify the site in Search Console if you want "official URL" status)

## Privacy practices tab

**Single purpose:** Record a Google Meet meeting (or the tab or screen the user selects) and produce a transcript and AI summary of it.

**Permission justifications**
| Permission | Justification |
|---|---|
| `tabCapture` | Captures the audio and video of the tab the user chooses to record. |
| `desktopCapture` | Lets the user optionally record their whole screen or a window instead of the tab. |
| `offscreen` | MediaRecorder and Web Audio need a document; the extension's service worker has none. Used only while recording. |
| `activeTab` | Chrome requires the user to invoke the extension on a tab before tabCapture can record it. |
| `storage` | Saves settings, the user's API keys and the one-time notice acceptance. |
| `unlimitedStorage` | Stores recordings (a video can be hundreds of MB) in the browser's IndexedDB. |
| Host: `api.groq.com`, `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com` | Sends audio for transcription, and transcript text for summarising, to the provider the user selects, using the user's own API key. |
| Optional hosts (`https://*/*`, localhost) | Requested at runtime, only for a custom server the user types into Settings. |
| Content script on `meet.google.com` | Detects when a call ends (so the recording stops), shows a "Recording" badge to the user, and posts one notice message in the call chat so participants know the call is recorded (optional, on by default). Reads only WebRTC connection state; it does not read page content or chat messages. |

**Remote code:** No, I am not using remote code.

**Data usage (check these):**
- Personal communications (call audio)
- Website content (video of the tab/screen)
- Authentication information (the user's API keys, stored locally)

**Certify all three:** data is not sold; not used or transferred for purposes unrelated to the single purpose; not used for creditworthiness or lending.

## Assets you still need to make
- [ ] Store icon 128×128 (done: `icons/icon-128.png`)
- [ ] 1–5 screenshots at **1280×800** (record a real call; show the meeting page with video + summary, the popup, Settings)
- [ ] Small promo tile **440×280** PNG/JPEG
- [ ] Marquee tile 1400×560 (optional), YouTube demo video (optional)

## Account steps
- [ ] Chrome Web Store developer account ($5 one-time fee)
- [ ] 2-Step Verification on the Google account (required to publish)
- [ ] Verify your contact email in the dashboard
- [ ] Upload `recap-0.1.0.zip`
