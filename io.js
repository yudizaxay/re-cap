// Export meetings to a folder on disk and import them back, using the File System Access API.
// Each meeting becomes one folder so it stays readable and playable without re:cap:
//   <date> <title>/meeting.json, recording.webm, audio-N.webm, transcript.md, summary.md
import { getMedia, getAudio, getMeeting, putMeeting, putMedia, putAudio } from './db.js';

const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'meeting';
const stamp = (iso) => iso.slice(0, 16).replace('T', ' ').replace(':', '-');

async function write(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}

export async function exportMeetings(meetings, onProgress = () => {}) {
  const root = await showDirectoryPicker({ id: 'recap-export', mode: 'readwrite' });
  const used = new Set();
  let done = 0;
  for (const m of meetings) {
    let name = `${stamp(m.startedAt)} ${safe(m.title)}`;
    if (used.has(name)) name += ` (${used.size})`;
    used.add(name);
    const dir = await root.getDirectoryHandle(name, { create: true });

    const media = await getMedia(m.id);
    const audio = await getAudio(m.id);
    const meta = {
      ...m,
      format: 1,
      mediaFile: media.length ? 'recording.webm' : null,
      audioSegments: audio.map((a) => ({ file: `audio-${a.index}.webm`, index: a.index, seconds: a.seconds })),
    };
    await write(dir, 'meeting.json', JSON.stringify(meta, null, 2));
    if (media.length) await write(dir, 'recording.webm', new Blob(media, { type: m.hasVideo ? 'video/webm' : 'audio/webm' }));
    for (const a of audio) await write(dir, `audio-${a.index}.webm`, a.blob);
    if (m.transcript) await write(dir, 'transcript.md', m.transcript);
    if (m.summary) await write(dir, 'summary.md', `# ${m.title}\n\n${m.summary}\n`);
    onProgress(++done, meetings.length);
  }
  return { count: done, folder: root.name };
}

const hasFile = async (dir, name) => { try { await dir.getFileHandle(name); return true; } catch { return false; } };

export async function importMeetings(onProgress = () => {}) {
  const root = await showDirectoryPicker({ id: 'recap-import' });
  const dirs = [];
  if (await hasFile(root, 'meeting.json')) dirs.push(root);
  else for await (const [, handle] of root.entries()) if (handle.kind === 'directory' && await hasFile(handle, 'meeting.json')) dirs.push(handle);
  if (!dirs.length) throw new Error('No re:cap meetings found in that folder. Choose a folder created by Export (or one meeting folder).');

  let imported = 0;
  let skipped = 0;
  for (const dir of dirs) {
    const meta = JSON.parse(await (await (await dir.getFileHandle('meeting.json')).getFile()).text());
    if (!/^[\w.:-]{1,64}$/.test(meta.id || '') || await getMeeting(meta.id)) { skipped++; continue; } // ids become DOM attributes, so only accept plain ones

    const { format, mediaFile, audioSegments = [], ...meeting } = meta;
    if (mediaFile && await hasFile(dir, mediaFile)) await putMedia(meta.id, 0, await (await dir.getFileHandle(mediaFile)).getFile());
    for (const seg of audioSegments) {
      if (await hasFile(dir, seg.file)) await putAudio(meta.id, seg.index, await (await dir.getFileHandle(seg.file)).getFile(), seg.seconds);
    }
    // A meeting exported mid-processing has no result yet; let it be processed again.
    if (['recording', 'transcribing', 'summarizing'].includes(meeting.status)) meeting.status = 'recorded';
    await putMeeting(meeting);
    onProgress(++imported, dirs.length);
  }
  return { imported, skipped };
}
