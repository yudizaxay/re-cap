// Transcription + summary requests. Runs in extension pages, where host_permissions bypass CORS.
export async function transcribeBlob(blob, name, settings, offsetSeconds) {
  const form = new FormData();
  form.append('file', blob, name);
  form.append('model', settings.transcriptionModel);
  form.append('response_format', 'verbose_json');
  if (settings.language) form.append('language', settings.language);

  const res = await fetch(`${settings.transcriptionBaseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${settings.transcriptionKey}` }, body: form,
  });
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts = data.segments?.length ? data.segments : [{ start: 0, text: data.text || '' }];
  return parts.map((s) => ({ start: offsetSeconds + (s.start || 0), text: String(s.text).trim() })).filter((s) => s.text);
}

export const clock = (sec) => {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const formatTranscript = (segs) => segs.map((s) => `[${clock(s.start)}] ${s.text}`).join('\n');

const PROMPT = (title, transcript) => `You are a meeting notetaker. Below is the transcript of a meeting titled "${title}", with [mm:ss] timestamps. The transcript has no speaker labels, so do not invent names; only attribute something to a person if they are named in the conversation.

Write the notes in Markdown with exactly these sections:
## Summary
A short paragraph.
## Key points
Bullets.
## Decisions
Bullets, or "None recorded".
## Action items
Bullets as "- [ ] task (owner if stated, due date if stated) [mm:ss]". Write "None recorded" if there are none.
## Open questions
Bullets, or "None".

Write in the language of the meeting. Be faithful to the transcript; do not add anything it doesn't support.
If the transcript is mostly unintelligible, garbled, or too short to contain real content, say that plainly in the Summary (suggest checking the language setting and audio), do not quote the garbled text, and write "None recorded" for the other sections.

<transcript>
${transcript}
</transcript>`;

export async function summarize(transcript, title, settings) {
  if (!transcript.trim()) return '## Summary\nNo speech was detected in this recording.';
  if (settings.summaryBaseUrl) return summarizeCompatible(transcript, title, settings);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': settings.anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: settings.anthropicModel, max_tokens: 4096, messages: [{ role: 'user', content: PROMPT(title, transcript) }] }),
  });
  if (!res.ok) throw new Error(`Summary failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

// Any OpenAI-compatible /chat/completions endpoint (Groq, a local server, ...).
const MODEL_PREFERENCE = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
const NOT_CHAT = /whisper|guard|orpheus|safeguard|allam|tts|embed/i;
const CHUNK_CHARS = 12000; // free tiers cap tokens per request, so long transcripts are summarised in parts

async function chatOnce(settings, model, content) {
  const res = await fetch(`${settings.summaryBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.summaryKey || settings.transcriptionKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw Object.assign(new Error(`Summary failed (${res.status}): ${(await res.text()).slice(0, 300)}`), { status: res.status });
  const text = (await res.json()).choices[0].message.content || '';
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

// Models get renamed, retired, or blocked per project; try each available chat model before giving up.
async function listChatModels(settings) {
  const res = await fetch(`${settings.summaryBaseUrl.replace(/\/$/, '')}/models`, {
    headers: { Authorization: `Bearer ${settings.summaryKey || settings.transcriptionKey}` },
  });
  if (!res.ok) return [];
  const ids = (await res.json()).data.map((m) => m.id.replace(/^models\//, '')).filter((id) => !NOT_CHAT.test(id) && !/image|imagen|veo|live|audio|robotics/i.test(id));
  const rest = ids.filter((id) => !MODEL_PREFERENCE.includes(id)).sort((a, b) => /flash/.test(b) - /flash/.test(a) || a.localeCompare(b));
  return [...MODEL_PREFERENCE.filter((id) => ids.includes(id)), ...rest];
}

const friendly = (err, tried) => new Error(
  `Summary failed: none of the models tried (${[...tried].join(', ')}) could be used. ` +
  `${err.status === 403 ? 'Your provider project has them blocked. ' : ''}` +
  'On Groq, open https://console.groq.com/settings/project/limits and allow a chat model (e.g. openai/gpt-oss-120b), then click Try again. ' +
  `Last error: ${err.message}`);

async function summarizeCompatible(transcript, title, settings) {
  let model = settings.summaryModel;
  const tried = new Set([model]);
  let candidates = null;
  const chat = async (content) => {
    for (;;) {
      try {
        return await chatOnce(settings, model, content);
      } catch (err) {
        if (![400, 403, 404].includes(err.status)) throw err;
        candidates ??= await listChatModels(settings);
        const next = candidates.find((id) => !tried.has(id));
        if (!next || tried.size >= 5) throw friendly(err, tried);
        tried.add(next);
        model = next;
      }
    }
  };

  if (transcript.length <= CHUNK_CHARS) return chat(PROMPT(title, transcript));

  const parts = [];
  let cur = '';
  for (const line of transcript.split('\n')) {
    if (cur.length + line.length > CHUNK_CHARS && cur) { parts.push(cur); cur = ''; }
    cur += line + '\n';
  }
  if (cur) parts.push(cur);

  const partial = [];
  for (const [i, part] of parts.entries()) partial.push(await chat(`${PROMPT(title, part)}\n\n(This is part ${i + 1} of ${parts.length} of the meeting.)`));
  return chat(`Merge these partial meeting notes for "${title}" into ONE set of notes with exactly the same Markdown sections (Summary, Key points, Decisions, Action items, Open questions). Remove duplicates, keep the [mm:ss] timestamps on action items, and add nothing that is not in the notes.\n\n${partial.map((n, i) => `--- Part ${i + 1} ---\n${n}`).join('\n\n')}`);
}
