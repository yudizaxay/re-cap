// Coordinates the popup, the offscreen recorder and the Meet page indicator.
const OFFSCREEN = 'offscreen.html';

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN, reasons: ['USER_MEDIA'], justification: 'Record tab audio and microphone during a meeting.',
  });
}

// Show the finished meeting in a tab (reusing an open re:cap tab), once per meeting.
async function openMeeting(id) {
  if (!id) return;
  const { opened = [] } = await chrome.storage.session.get('opened');
  if (opened.includes(id)) return;
  await chrome.storage.session.set({ opened: [...opened.slice(-20), id] });
  const base = chrome.runtime.getURL('app.html');
  const url = `${base}#meeting=${id}`;
  const [existing] = await chrome.tabs.query({ url: `${base}*` });
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

async function setRecording(state) {
  await chrome.storage.session.set({ recording: state });
  await chrome.action.setBadgeText({ text: state ? 'REC' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e5342d' });
  if (state?.tabId) chrome.tabs.sendMessage(state.tabId, { type: 'recording', on: true, id: state.id }).catch(() => {});
}

// Shared by every way a recording ends: popup Stop, the call ending, or the Meet tab closing.
async function finishRecording(recording) {
  await setRecording(null);
  if (recording.tabId) chrome.tabs.sendMessage(recording.tabId, { type: 'recording', on: false }).catch(() => {});
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' });
  openMeeting(recording.id);
}

// Drop settings from earlier versions that no longer exist.
chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove(['autoRecord', 'autoVideo']));

const HANDLED = new Set(['start', 'stop', 'process', 'status', 'get-settings', 'state', 'call-ended']);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!HANDLED.has(msg.type) || msg.target) return; // offscreen-bound messages are not ours
  (async () => {
    if (msg.type === 'get-settings') {
      return sendResponse((await chrome.storage.local.get('settings')).settings || {});
    }
    if (msg.type === 'start') {
      await ensureOffscreen();
      let { streamId } = msg;
      let desktopStreamId = null;
      if (msg.source === 'screen') {
        // Picker for the whole screen or a window (the popup closes when it opens, so this runs here).
        const tab = await chrome.tabs.get(msg.tabId);
        desktopStreamId = await new Promise((resolve) => chrome.desktopCapture.chooseDesktopMedia(['screen', 'window'], tab, (id) => resolve(id || null)));
        if (!desktopStreamId) return sendResponse({ error: 'Screen selection was cancelled.' });
        streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: msg.tabId }); // call audio still comes from the tab
      }
      const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, desktopStreamId, title: msg.title, video: msg.video, tabId: msg.tabId });
      if (res?.error) return sendResponse({ error: res.error });
      await setRecording({ id: res.id, tabId: msg.tabId, startedAt: Date.now() });
      return sendResponse({ ok: true });
    }
    if (msg.type === 'stop') {
      const { recording } = await chrome.storage.session.get('recording');
      if (recording) await finishRecording(recording);
      return sendResponse({ ok: true, id: recording?.id });
    }
    if (msg.type === 'call-ended') {
      // The Meet page saw the call end: stop the recording that belongs to this tab.
      const { recording } = await chrome.storage.session.get('recording');
      if (recording && recording.tabId === sender.tab?.id) await finishRecording(recording);
      return sendResponse({ ok: true });
    }
    if (msg.type === 'process') {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'process', id: msg.id });
      return sendResponse({ ok: true });
    }
    if (msg.type === 'state') {
      // The recorder is the source of truth: if it is capturing but our saved state is missing, restore it
      // so the popup can offer Stop instead of a Start that Chrome would refuse.
      let { recording } = await chrome.storage.session.get('recording');
      if (!recording && (await chrome.offscreen.hasDocument())) {
        const p = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' }).catch(() => null);
        if (p?.recording) {
          recording = { id: p.id, tabId: p.tabId, startedAt: p.startedAt };
          await setRecording(recording);
        }
      }
      return sendResponse({ recording: recording || null });
    }
    if (msg.type === 'status') {
      const { recording } = await chrome.storage.session.get('recording');
      return sendResponse({ recording: recording || null, isThisTab: recording?.tabId === sender.tab?.id });
    }
  })().catch((err) => sendResponse({ error: String(err?.message || err) }));
  return true; // async response
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { recording } = await chrome.storage.session.get('recording');
  if (recording?.tabId === tabId) await finishRecording(recording); // tab closed: finish and process what was captured
});
