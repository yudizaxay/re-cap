import { putMeeting, getMeeting, putAudio, getAudio, putMedia, getSettings } from './db.js';
import { transcribeBlob, formatTranscript, summarize } from './pipeline.js';

const SEGMENT_MS = 20 * 60 * 1000; // keep each file under the 25 MB upload limit
let rec = null;

async function start({ streamId, desktopStreamId, title, video, tabId }) {
  // One call for both tracks: a tab stream id can only be consumed once.
  const constraint = { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } };
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: constraint,
    ...(video && !desktopStreamId ? { video: { mandatory: { ...constraint.mandatory, maxWidth: 1280, maxHeight: 720, maxFrameRate: 15 } } } : {}),
  });
  // Whole screen / window: the picture comes from the desktop picker, the call audio still from the tab.
  const screen = video && desktopStreamId
    ? await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: desktopStreamId, maxWidth: 1920, maxHeight: 1080, maxFrameRate: 15 } },
      })
    : null;
  const videoTracks = screen ? screen.getVideoTracks() : tab.getVideoTracks();
  let mic = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    // Mic not granted yet: the recording still captures the other participants.
  }

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const tabSource = ctx.createMediaStreamSource(new MediaStream(tab.getAudioTracks()));
  tabSource.connect(dest);
  tabSource.connect(ctx.destination); // capturing a tab mutes it, so play it back
  if (mic) ctx.createMediaStreamSource(mic).connect(dest);

  const id = new Date().toISOString().replace(/[:.]/g, '-');
  const hasVideo = videoTracks.length > 0;
  const meeting = { id, title: title || `Meeting ${new Date().toLocaleString()}`, startedAt: new Date().toISOString(), status: 'recording', micIncluded: !!mic, hasVideo, segments: 0, error: null };
  await putMeeting(meeting);

  rec = { id, ctx, streams: [tab, screen, mic].filter(Boolean), dest, index: 0, recorder: null, stopping: false, tabId, startedAt: Date.now(), hasVideo };
  startSegment();
  startPlaybackRecorder(videoTracks, !!screen);
  return { id, micIncluded: !!mic };
}

// Continuous recording for playback: tab video (optional) + the mixed call/mic audio, stored chunk by chunk
// so a long meeting never has to fit in memory.
function startPlaybackRecorder(videoTracks, isScreen) {
  const r = rec;
  const hasVideo = videoTracks.length > 0;
  const tracks = [...videoTracks, ...r.dest.stream.getAudioTracks()];
  const mimeType = hasVideo ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus';
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: MediaRecorder.isTypeSupported(mimeType) ? mimeType : hasVideo ? 'video/webm' : 'audio/webm',
    videoBitsPerSecond: isScreen ? 1_500_000 : 1_000_000, audioBitsPerSecond: 64000, // screens carry small text, so give them more
  });
  let n = 0;
  const writes = [];
  recorder.ondataavailable = (e) => e.data.size && writes.push(putMedia(r.id, n++, e.data));
  r.playbackDone = new Promise((resolve) => { recorder.onstop = () => Promise.all(writes).then(resolve); });
  r.playback = recorder;
  recorder.start(5000);
}

function startSegment() {
  const r = rec;
  const index = r.index++;
  const t0 = Date.now();
  const chunks = [];
  const recorder = new MediaRecorder(r.dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
  r.recorder = recorder;
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = async () => {
    clearTimeout(r.rotate);
    await putAudio(r.id, index, new Blob(chunks, { type: 'audio/webm' }), (Date.now() - t0) / 1000);
    if (r.stopping) r.resolveStopped(); else startSegment();
  };
  recorder.start(5000);
  r.rotate = setTimeout(() => recorder.state === 'recording' && recorder.stop(), SEGMENT_MS);
}

async function stop() {
  if (!rec) return;
  const r = rec;
  rec = null;
  r.stopping = true;
  const stopped = new Promise((res) => { r.resolveStopped = res; });
  if (r.recorder.state === 'recording') r.recorder.stop();
  if (r.playback?.state === 'recording') r.playback.stop();
  await Promise.all([stopped, r.playbackDone]);
  r.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  await r.ctx.close();
  const m = await getMeeting(r.id);
  await putMeeting({ ...m, status: 'recorded', endedAt: new Date().toISOString() });
  await process(r.id);
}

async function process(id) {
  let m = await getMeeting(id);
  const save = async (patch) => { m = { ...m, ...patch }; await putMeeting(m); };
  try {
    const settings = await getSettings();
    if (!settings.transcriptionKey) return await save({ status: 'needs-key', error: 'Add a transcription API key in Settings, then click Process again.' });
    await save({ status: 'transcribing', error: null });
    const segments = [];
    let offset = 0;
    for (const a of await getAudio(id)) {
      if (a.blob.size > 2048) segments.push(...(await transcribeBlob(a.blob, `seg-${a.index}.webm`, settings, offset)));
      offset += a.seconds;
    }
    const transcript = formatTranscript(segments);
    await save({ transcript });
    if (!settings.anthropicKey && !settings.summaryBaseUrl) return save({ status: 'transcribed', error: 'Add an Anthropic key (or a free summary provider) in Settings to generate a summary.' });
    await save({ status: 'summarizing' });
    await save({ summary: await summarize(transcript, m.title, settings), status: 'done', error: null });
  } catch (err) {
    await save({ status: 'error', error: String(err.message || err) });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'ping') {
    sendResponse(rec ? { recording: true, id: rec.id, tabId: rec.tabId, startedAt: rec.startedAt } : { recording: false });
    return;
  }
  if (msg.type === 'start') start(msg).then(sendResponse, (e) => sendResponse({ error: String(e.message || e) }));
  if (msg.type === 'stop') stop().then(() => sendResponse({ ok: true }));
  if (msg.type === 'process') process(msg.id).then(() => sendResponse({ ok: true }));
  return true;
});
