# re:cap Privacy Policy

**Effective date:** 22 October 2026
**Developer:** Akshay Singh (https://axaysingh.com, https://github.com/yudizaxay)
**Contact:** axayrs@gmail.com

re:cap is a browser extension that records a meeting you choose to record and turns it into a transcript and summary. This policy explains what it handles and where that data goes.

## The short version

- re:cap has **no servers**. The developer never receives, sees or stores your recordings, transcripts, summaries or API keys.
- Everything is stored **inside your own browser** on your computer.
- Audio and text leave your computer **only** to the AI provider **you** select and supply a key for, and **only** when a recording is processed.
- We do not sell data, show ads, or use data for anything except the features described here. No human reads your data.

## What re:cap handles

| Data                                                    | Why                               | Where it lives                                                             |
| ------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| Audio of the tab you record, and your microphone        | To record the meeting             | Browser storage (IndexedDB) on your computer                               |
| Video of the tab or screen/window you choose (optional) | To record the meeting visually    | Browser storage on your computer                                           |
| Transcript and summary text                             | To show you the results           | Browser storage on your computer                                           |
| Meeting title (taken from the tab title)                | To label the meeting              | Browser storage on your computer                                           |
| Your API keys and settings                              | To call the AI provider you chose | Extension storage (`chrome.storage.local`) on your computer, not encrypted |
| A record that you accepted the disclosure               | So the notice is shown once       | Extension storage on your computer                                         |

re:cap does **not** collect browsing history, and its only content script runs on `meet.google.com` to detect when a call ends, to show a "Recording" badge to you, and (unless you turn it off in Settings) to post one notice message in the call chat so participants know the call is being recorded. It reads the connection state of the call only. It does not read the page's content, chat messages, names or media.

## Who receives data

Only when you process a recording, re:cap sends data directly from your browser, over HTTPS, to the provider you selected in Settings:

- **Transcription** (audio): Groq, OpenAI, or a custom server you configure.
- **Summary** (transcript text): Groq, Anthropic, Google (Gemini), or a custom server you configure.

These providers process data under **their own** terms and privacy policies, using **your** API key and account. Free tiers of some providers may use submitted content to improve their products; check your provider's terms, and do not send confidential calls to a provider you do not trust. re:cap sends nothing anywhere else.

## Your control

- Delete any meeting inside re:cap, or remove the extension, to delete the stored data.
- Use **Export** to save your meetings as files and **Import** to bring them back.
- Remove or change your API keys any time in Settings.

## Recording other people

You are responsible for telling everyone on a call that it is being recorded and for following the recording-consent laws that apply to you. On Google Meet, re:cap posts a notice in the call chat when recording starts (you can turn this off in Settings), and shows a red "Recording" badge on your own screen. On other meeting sites, re:cap does not notify other participants, so you must tell them yourself.

## Limited Use

The use of information received from Chrome APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the recording, transcription and summary features, is not transferred to third parties except to the providers you select as described above, is not used for advertising, and is not read by humans.

## Children

re:cap is not directed to children under 13.

## Changes

If this policy changes, the new version will be posted at the same address with a new effective date, and material changes in data practices will be disclosed inside the extension.
