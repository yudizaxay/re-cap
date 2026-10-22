const $ = (id) => document.getElementById(id);

async function micAllowed() {
  try { return (await navigator.permissions.query({ name: 'microphone' })).state === 'granted'; } catch { return false; }
}

let timerId;
function runTimer(startedAt) {
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    $('timer').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };
  tick();
  timerId = setInterval(tick, 500);
}

async function init() {
  clearInterval(timerId);
  $('live').hidden = true;
  $('idle').hidden = true;
  // Ask the background worker; if it didn't answer (e.g. an old worker before a reload), fall back to saved state.
  const reply = await chrome.runtime.sendMessage({ type: 'state' }).catch(() => null);
  const recording = reply && 'recording' in reply ? reply.recording : (await chrome.storage.session.get('recording')).recording;
  if (recording) {
    $('live').hidden = false;
    runTimer(recording.startedAt);
    return;
  }
  $('idle').hidden = false;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Any normal web page can be recorded (Meet, Zoom web, Teams web); browser and extension pages cannot.
  const url = tab?.url || '';
  const host = url ? new URL(url).hostname : '';
  const blocked = !tab || /^(chrome|chrome-extension|edge|about|devtools):/.test(url);
  $('where').textContent = blocked ? 'Switch to your Google Meet tab, then click re:cap again.'
    : host === 'meet.google.com' ? `Ready to record: ${tab.title}`
    : `Will record this tab: ${tab.title || host}${host ? ` (${host})` : ''}`;
  $('mic-warn').hidden = await micAllowed();
  $('start').disabled = blocked;

  // One-time disclosure and consent (Chrome Web Store user-data policy): nothing records before the user agrees.
  const agreed = !!(await chrome.storage.local.get('consent')).consent;
  $('consent-box').hidden = agreed;
  document.querySelectorAll('.gated').forEach((el) => { el.hidden = !agreed; });
  $('agree').onclick = async () => { await chrome.storage.local.set({ consent: { version: 1, at: Date.now() } }); init(); };


  $('source').value = (await chrome.storage.local.get('videoSource')).videoSource || 'tab';

  $('start').onclick = async () => {
    $('error').textContent = '';
    try {
      const source = $('source').value;
      chrome.storage.local.set({ videoSource: source });
      const title = tab.title.replace(/^Meet\s*[-–]\s*/, '');
      // The popup click counts as the user gesture tabCapture requires. For "screen" the background asks
      // for the tab audio after the picker, because the popup closes as soon as the picker opens.
      const streamId = source === 'screen' ? null : await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      const res = await chrome.runtime.sendMessage({ type: 'start', streamId, source, tabId: tab.id, title, video: source !== 'none' });
      if (res?.error) throw new Error(res.error);
      window.close();
    } catch (err) {
      const msg = String(err.message || err);
      if (/active stream/i.test(msg)) { await init(); return; } // this tab is already being recorded: show Stop
      $('error').textContent = msg;
    }
  };
}

$('stop').onclick = async () => {
  clearInterval(timerId);
  await chrome.runtime.sendMessage({ type: 'stop' });
  window.close();
};
$('open').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
$('grant').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('app.html#mic') });

init();
