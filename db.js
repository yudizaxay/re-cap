// Minimal IndexedDB wrapper shared by the offscreen recorder and the results page.
const open = () => new Promise((resolve, reject) => {
  const req = indexedDB.open('meet-recorder', 2);
  req.onupgradeneeded = (e) => {
    const db = req.result;
    if (e.oldVersion < 1) {
      db.createObjectStore('meetings', { keyPath: 'id' });
      db.createObjectStore('audio', { keyPath: ['id', 'index'] });
    }
    if (e.oldVersion < 2) db.createObjectStore('media', { keyPath: ['id', 'n'] }); // playback recording, chunk by chunk
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(result?.result); };
    tx.onerror = () => reject(tx.error);
  });
}

export const putMeeting = (m) => run('meetings', 'readwrite', (s) => s.put(m));
export const getMeeting = (id) => run('meetings', 'readonly', (s) => s.get(id));
export const allMeetings = async () => (await run('meetings', 'readonly', (s) => s.getAll())).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
export const putAudio = (id, index, blob, seconds) => run('audio', 'readwrite', (s) => s.put({ id, index, blob, seconds }));
export const getAudio = (id) => run('audio', 'readonly', (s) => s.getAll(IDBKeyRange.bound([id, 0], [id, Infinity])));

export const putMedia = (id, n, blob) => run('media', 'readwrite', (s) => s.put({ id, n, blob }));
export const getMedia = async (id) => (await run('media', 'readonly', (s) => s.getAll(IDBKeyRange.bound([id, 0], [id, Infinity])))).map((c) => c.blob);

export async function deleteMeeting(id) {
  await run('media', 'readwrite', (s) => s.delete(IDBKeyRange.bound([id, 0], [id, Infinity])));
  await run('meetings', 'readwrite', (s) => s.delete(id));
  await run('audio', 'readwrite', (s) => s.delete(IDBKeyRange.bound([id, 0], [id, Infinity])));
}

export async function getSettings() {
  // Offscreen documents only expose chrome.runtime, so they ask the background worker for storage.
  const settings = chrome.storage?.local
    ? (await chrome.storage.local.get('settings')).settings
    : await chrome.runtime.sendMessage({ type: 'get-settings' });
  return {
    provider: 'groq', announce: true,
    transcriptionKey: '', transcriptionBaseUrl: 'https://api.groq.com/openai/v1', transcriptionModel: 'whisper-large-v3',
    language: '', anthropicKey: '', anthropicModel: 'claude-sonnet-5-5',
    summaryBaseUrl: 'https://api.groq.com/openai/v1', summaryKey: '', summaryModel: 'openai/gpt-oss-120b', ...settings,
  };
}
export const setSettings = (settings) => chrome.storage.local.set({ settings });
