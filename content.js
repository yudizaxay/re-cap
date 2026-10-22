// Isolated-world bridge on meet.google.com: shows the "Recording" pill and tells the extension when the call ends,
// so a running recording stops by itself.
let pill;
function setPill(on) {
  if (!on) { pill?.remove(); pill = null; return; }
  if (pill) return;
  pill = document.createElement('div');
  pill.textContent = '● Recording (re:cap)';
  Object.assign(pill.style, {
    position: 'fixed', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
    background: '#e5342d', color: '#fff', font: '600 13px system-ui, sans-serif', padding: '6px 14px',
    borderRadius: '999px', boxShadow: '0 4px 16px rgba(0,0,0,.3)', pointerEvents: 'none',
  });
  document.documentElement.appendChild(pill);
}

// ---- recording notice in the Meet chat -------------------------------------------------------------
// Meet gives extensions no way to show its own "recording" banner to other participants, so the notice is
// posted as a normal chat message from the user's account. Best effort: Meet's markup changes and is localised,
// so elements are found by role/icon rather than exact text, and a failure is reported instead of hidden.
const DEFAULT_NOTICE = "Heads up: I'm recording this meeting and creating an AI transcript and summary (re:cap). If you'd rather not be recorded, please tell me now.";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => !!el && el.offsetParent !== null;
const iconText = (el) => [...el.querySelectorAll('i, span')].map((n) => n.textContent.trim());
const findInput = () => [...document.querySelectorAll('textarea')].find(visible);
const findChatToggle = () => [...document.querySelectorAll('button')].find((b) =>
  /chat/i.test(b.getAttribute('aria-label') || '') || iconText(b).some((t) => /^(chat|chat_bubble)$/.test(t)));
const findSend = (input) => {
  const root = input.closest('form') || input.parentElement?.parentElement?.parentElement || document;
  return [...root.querySelectorAll('button')].find((b) =>
    /send/i.test(b.getAttribute('aria-label') || '') || iconText(b).includes('send'));
};

async function postChatNotice(text) {
  let input = findInput();
  let toggle = null;
  if (!input) {
    toggle = findChatToggle();
    if (!toggle) return false;
    toggle.click();
    for (let i = 0; i < 25 && !(input = findInput()); i++) await wait(200);
    if (!input) return false;
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  input.focus();
  setValue.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(150);
  const send = findSend(input);
  if (send && !send.disabled) send.click();
  else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  await wait(600);
  const sent = input.value === '';
  if (toggle && sent) findChatToggle()?.click(); // put the panel back the way we found it
  return sent;
}

let toast;
function showToast(text) {
  toast?.remove();
  toast = document.createElement('div');
  toast.textContent = text;
  Object.assign(toast.style, {
    position: 'fixed', top: '52px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
    background: '#000082', color: '#fff', font: '500 13px system-ui, sans-serif', padding: '8px 16px',
    borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,.3)', maxWidth: '80vw', textAlign: 'center',
  });
  document.documentElement.appendChild(toast);
  setTimeout(() => toast?.remove(), 9000);
}

let pendingNotice = null; // id of a recording whose notice has not been posted yet
let noticeBusy = false;
let inCall = false;       // chat only exists once the user has joined, so wait for the call to start
async function tryNotice() {
  if (!pendingNotice || noticeBusy || !inCall) return;
  const { settings } = await chrome.storage.local.get('settings');
  if (settings?.announce === false) { pendingNotice = null; return; }
  noticeBusy = true;
  const id = pendingNotice;
  for (let i = 0; i < 3 && pendingNotice === id; i++) {
    if (await postChatNotice(settings?.noticeText?.trim() || DEFAULT_NOTICE)) { pendingNotice = null; break; }
    await wait(2500);
  }
  noticeBusy = false;
  // Still pending after retries while in the call: chat is unavailable (disabled by the host, or Meet changed).
  if (pendingNotice === id) {
    showToast('Could not post the recording notice in chat. Please tell everyone you are recording.');
    pendingNotice = null;
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'recap-hook') return;
  if (e.data.type === 'call-started') { inCall = true; tryNotice(); }
  if (e.data.type === 'call-ended') inCall = false;
  if (e.data.type === 'call-ended') chrome.runtime.sendMessage({ type: 'call-ended' }).catch(() => {});
});

let lastNoticeId = null;
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'recording') return;
  setPill(msg.on);
  if (msg.on && msg.id && msg.id !== lastNoticeId) { lastNoticeId = msg.id; pendingNotice = msg.id; tryNotice(); }
});
chrome.runtime.sendMessage({ type: 'status' }).then((r) => r?.isThisTab && setPill(true)).catch(() => {});
