import { exportMeetings, importMeetings } from './io.js';
import { ABOUT } from './about.js';
import { allMeetings, getMeeting, deleteMeeting, putMeeting, getMedia, getSettings, setSettings } from './db.js';

const $ = (id) => document.getElementById(id);
let meetings = [];
const fromHash = () => (location.hash.match(/meeting=([^&]+)/) || [])[1] || null;
let selectedId = fromHash();
let tab = 'summary';

const TS = /\[((?:\d+:)?\d{1,2}:\d{2})\]/g;
const toSeconds = (t) => t.split(':').reduce((a, n) => a * 60 + Number(n), 0);
const tsButton = (t) => `<button class="ts" data-t="${toSeconds(t)}">[${t}]</button>`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function markdown(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(TS, (_m, t) => tsButton(t));
  const out = [];
  let inList = false;
  for (const line of md.split('\n')) {
    const li = line.match(/^\s*[-*] (?:\[( |x)\] )?(.*)/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      const box = li[1] !== undefined ? `<input type="checkbox" disabled ${li[1] === 'x' ? 'checked' : ''}> ` : '';
      out.push(`<li>${box}${inline(li[2])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = line.match(/^#{1,3} (.*)/);
    if (h) out.push(`<h3>${inline(h[1])}</h3>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

const STATUS = { recording: 'Recording…', recorded: 'Saved. Starting transcription…', transcribing: 'Transcribing…', summarizing: 'Writing summary…', transcribed: 'Transcript ready.' };
const BUSY = ['recording', 'recorded', 'transcribing', 'summarizing'];

const STATUS_CHIP = {
  done: ['Ready', 'st-done'], recording: ['Recording', 'st-rec'], error: ['Error', 'st-error'], 'needs-key': ['Needs key', ''],
  transcribed: ['Transcript only', ''], recorded: ['Processing', ''], transcribing: ['Processing', ''], summarizing: ['Processing', ''],
};

function renderList() {
  $('list').innerHTML = meetings.map((m) => {
    const [label, cls] = STATUS_CHIP[m.status] || [m.status, ''];
    const when = new Date(m.startedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    return `<li data-id="${esc(m.id)}" class="${m.id === selectedId ? 'active' : ''}">
      <b>${esc(m.title)}</b>
      <small>${when} · ${m.hasVideo ? 'Video' : 'Audio'} · <span class="st ${cls}">${label}</span></small></li>`;
  }).join('');
}

let shown = { id: null, sig: '', tab: '' };
let player = { id: null, url: null };

async function mountPlayer(m) {
  const box = $('player');
  const ready = m.status !== 'recording';
  if (!ready) { box.innerHTML = '<div class="no-media">Recording in progress…</div>'; box.hidden = false; return; }
  if (player.id === m.id) return;
  const chunks = await getMedia(m.id);
  if (!chunks.length) { box.innerHTML = '<div class="no-media">No recording was saved for this meeting.</div>'; box.hidden = false; return; }
  if (player.url) URL.revokeObjectURL(player.url);
  player = { id: m.id, url: URL.createObjectURL(new Blob(chunks, { type: m.hasVideo ? 'video/webm' : 'audio/webm' })) };
  box.innerHTML = m.hasVideo ? '<video controls preload="metadata"></video>' : '<audio controls preload="metadata"></audio>';
  const el = box.firstChild;
  el.src = player.url;
  // MediaRecorder files report an infinite duration; seeking far forces Chrome to compute the real one.
  el.addEventListener('loadedmetadata', () => {
    if (el.duration !== Infinity) return;
    el.currentTime = 1e101;
    el.addEventListener('timeupdate', () => { el.currentTime = 0; }, { once: true });
  });
  box.hidden = false;
}

function transcriptHtml(text) {
  return text.split('\n').map((line) => {
    const m = line.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\] (.*)/);
    return m ? `<div class="line">${tsButton(m[1])}<span>${esc(m[2])}</span></div>` : '';
  }).join('');
}

function bannerFor(m) {
  const text = m.error || STATUS[m.status];
  if (m.status === 'needs-key') return { kind: 'warn', text: 'Add your free Groq API key to get the transcript and summary.', action: { label: 'Open settings', run: () => openSettings() } };
  if (m.status === 'transcribed' && m.error) return { kind: 'warn', text: m.error, action: { label: 'Open settings', run: () => openSettings() } };
  if (m.status === 'error') return { kind: 'error', text: m.error, action: { label: 'Try again', run: () => chrome.runtime.sendMessage({ type: 'process', id: m.id }) } };
  if (BUSY.includes(m.status)) return { kind: 'info', text: text || 'Working on it…' };
  if (m.micIncluded === false) return { kind: 'warn', text: 'Microphone was not allowed, so only other participants were recorded.', action: { label: 'Allow microphone', run: () => openSettings() } };
  return null;
}

function metaLine(m) {
  const parts = [new Date(m.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })];
  if (m.endedAt) {
    const s = Math.max(0, Math.round((new Date(m.endedAt) - new Date(m.startedAt)) / 1000));
    parts.push(`${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`);
  }
  parts.push(m.hasVideo ? 'Video + audio' : 'Audio only');
  return parts.join(' · ');
}

async function renderDetail() {
  const m = selectedId && (await getMeeting(selectedId));
  $('empty').hidden = !!m;
  $('detail').hidden = !m;
  if (!m) { $('player').hidden = true; return; }
  // The page polls while the recorder works; only redraw when something changed so playback isn't interrupted.
  const sig = [m.status, m.title, m.error, (m.summary || '').length, (m.transcript || '').length].join('|');
  if (shown.id === m.id && shown.sig === sig && shown.tab === tab) return;
  shown = { id: m.id, sig, tab };

  if (document.activeElement !== $('title')) $('title').value = m.title;
  $('meta').textContent = metaLine(m);

  const banner = bannerFor(m);
  $('status').hidden = !banner;
  if (banner) {
    $('status').className = `banner ${banner.kind}`;
    $('status-text').textContent = banner.text;
    $('status-action').hidden = !banner.action;
    if (banner.action) { $('status-action').textContent = banner.action.label; $('status-action').onclick = banner.action.run; }
  }

  $('reprocess').disabled = ['recording', 'transcribing', 'summarizing'].includes(m.status);
  const body = (tab === 'summary' ? m.summary : m.transcript) || '';
  const empty = BUSY.includes(m.status) ? 'Working on it…' : m.status === 'needs-key' ? `Your ${tab} will appear here once a key is added.` : `No ${tab} yet.`;
  $('content').innerHTML = body ? (tab === 'summary' ? markdown(body) : transcriptHtml(body)) : `<p class="muted">${empty}</p>`;
  $('copy').onclick = () => { navigator.clipboard.writeText(body); $('menu').open = false; };
  $('download').onclick = () => {
    const text = `# ${m.title}\n\n${m.summary || ''}\n\n## Transcript\n${m.transcript || ''}\n`;
    Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: `${m.title.replace(/[^\w -]+/g, '')}.md` }).click();
    $('menu').open = false;
  };
  await mountPlayer(m);
}

$('download-media').onclick = async () => {
  $('menu').open = false;
  const m = await getMeeting(selectedId);
  const chunks = await getMedia(selectedId);
  if (!chunks.length) { ask({ title: 'No recording to save', text: 'This meeting has no recording stored in this browser.', ok: 'OK', cancel: false }); return; }
  const blob = new Blob(chunks, { type: m.hasVideo ? 'video/webm' : 'audio/webm' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${m.title.replace(/[^\w -]+/g, '')}.webm` }).click();
};

$('content').onclick = (e) => {
  const b = e.target.closest('.ts');
  const el = $('player').firstChild;
  if (!b || !el) return;
  el.currentTime = Number(b.dataset.t);
  el.play();
};

async function refresh() {
  meetings = await allMeetings();
  if (!selectedId && meetings.length) selectedId = meetings[0].id; // open the latest meeting by default
  renderList();
  renderDetail();
}

$('list').onclick = (e) => { const li = e.target.closest('li'); if (li) { selectedId = li.dataset.id; shown = { id: null, sig: '', tab: '' }; renderList(); renderDetail(); } };
$('title').onchange = async (e) => { const m = await getMeeting(selectedId); await putMeeting({ ...m, title: e.target.value }); refresh(); };
$('reprocess').onclick = () => chrome.runtime.sendMessage({ type: 'process', id: selectedId });
$('delete').onclick = async () => {
  $('menu').open = false;
  if (!(await ask({ title: 'Delete this meeting?', text: 'This permanently removes the recording, transcript and summary from this browser. Use Export first if you want a copy.', ok: 'Delete', danger: true }))) return;
  await deleteMeeting(selectedId);
  selectedId = null;
  refresh();
};
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b)); renderDetail(); };
});

async function micState() {
  try { $('mic-state').textContent = (await navigator.permissions.query({ name: 'microphone' })).state; } catch { /* ignore */ }
}
$('mic').onclick = async () => {
  try {
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
  } catch { /* denied: shown below */ }
  micState();
};

const GROQ = { base: 'https://api.groq.com/openai/v1', stt: 'whisper-large-v3', llm: 'openai/gpt-oss-120b' };
const GEMINI = { base: 'https://generativelanguage.googleapis.com/v1beta/openai', llm: 'gemini-2.5-flash' };
const OPENAI = { base: 'https://api.openai.com/v1', stt: 'whisper-1' };

function showPanel() {
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== $('provider').value; });
}
$('provider').onchange = showPanel;

async function openSettings() {
  const s = await getSettings();
  $('provider').value = s.provider;
  $('g-key').value = s.provider === 'groq' ? s.transcriptionKey : '';
  $('m-gkey').value = s.provider === 'gemini' ? s.transcriptionKey : '';
  $('m-mkey').value = s.provider === 'gemini' ? s.summaryKey : '';
  $('p-okey').value = s.provider === 'paid' ? s.transcriptionKey : '';
  $('p-akey').value = s.anthropicKey;
  $('c-tkey').value = s.transcriptionKey; $('c-turl').value = s.transcriptionBaseUrl; $('c-tmodel').value = s.transcriptionModel;
  $('c-surl').value = s.summaryBaseUrl; $('c-smodel').value = s.summaryModel; $('c-skey').value = s.summaryKey; $('c-akey').value = s.anthropicKey;
  $('lang').value = s.language;
  $('announce').checked = s.announce !== false;
  $('notice').value = s.noticeText || '';
  showPanel();
  micState();
  $('settings').showModal();
}
$('open-settings').onclick = openSettings;

// Custom servers are outside the fixed provider list, so ask for access to exactly those origins when saving.
async function ensureHostAccess(urls) {
  const origins = [...new Set(urls.filter(Boolean).map((u) => {
    const url = new URL(u);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !local) throw new Error('Custom servers must use https (or be localhost).');
    return `${url.origin}/*`;
  }))];
  const missing = [];
  for (const o of origins) if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
  if (missing.length && !(await chrome.permissions.request({ origins: missing }))) throw new Error('Access to your custom server was not granted.');
}

$('save').onclick = async () => {
  const provider = $('provider').value;
  const v = (id) => $(id).value.trim();
  const base = { provider, announce: $('announce').checked, noticeText: v('notice'), language: v('lang'), anthropicModel: 'claude-sonnet-5-5' };
  const byProvider = {
    groq: { transcriptionKey: v('g-key'), transcriptionBaseUrl: GROQ.base, transcriptionModel: GROQ.stt,
            summaryBaseUrl: GROQ.base, summaryModel: GROQ.llm, summaryKey: '', anthropicKey: '' },
    gemini: { transcriptionKey: v('m-gkey'), transcriptionBaseUrl: GROQ.base, transcriptionModel: GROQ.stt,
              summaryBaseUrl: GEMINI.base, summaryModel: GEMINI.llm, summaryKey: v('m-mkey'), anthropicKey: '' },
    paid: { transcriptionKey: v('p-okey'), transcriptionBaseUrl: OPENAI.base, transcriptionModel: OPENAI.stt,
            summaryBaseUrl: '', summaryModel: '', summaryKey: '', anthropicKey: v('p-akey') },
    custom: { transcriptionKey: v('c-tkey'), transcriptionBaseUrl: v('c-turl'), transcriptionModel: v('c-tmodel'),
              summaryBaseUrl: v('c-surl'), summaryModel: v('c-smodel'), summaryKey: v('c-skey'), anthropicKey: v('c-akey') },
  };
  try {
    if (provider === 'custom') await ensureHostAccess([byProvider.custom.transcriptionBaseUrl, byProvider.custom.summaryBaseUrl]);
  } catch (err) {
    ioStatus(String(err.message || err));
    return;
  }
  return setSettings({ ...base, ...byProvider[provider] });
};

// Live-update while the offscreen recorder writes results to IndexedDB.
setInterval(refresh, 2000);
function ioStatus(text) { $('io-status').hidden = !text; $('io-status').textContent = text || ''; }
async function runIo(label, fn) {
  try {
    ioStatus(`${label}…`);
    ioStatus(await fn());
  } catch (err) {
    ioStatus(err.name === 'AbortError' ? '' : String(err.message || err)); // AbortError = user cancelled the folder picker
  }
}
$('export-all').onclick = () => runIo('Exporting', async () => {
  if (!meetings.length) return 'Nothing to export yet.';
  const r = await exportMeetings(meetings, (i, n) => ioStatus(`Exporting ${i}/${n}…`));
  return `Exported ${r.count} meeting${r.count === 1 ? '' : 's'} to "${r.folder}".`;
});
$('export-one').onclick = () => {
  $('menu').open = false;
  return runIo('Exporting', async () => {
    const r = await exportMeetings([await getMeeting(selectedId)]);
    return `Exported to "${r.folder}".`;
  });
};
$('import').onclick = () => runIo('Importing', async () => {
  const r = await importMeetings((i, n) => ioStatus(`Importing ${i}/${n}…`));
  await refresh();
  return `Imported ${r.imported}${r.skipped ? `, skipped ${r.skipped} already here` : ''}.`;
});

window.addEventListener('hashchange', () => {
  const id = fromHash();
  if (!id) return;
  selectedId = id;
  shown = { id: null, sig: '', tab: '' };
  refresh();
});
refresh();
if (location.hash === '#mic') openSettings();

// ---- home, settings tabs, about ----
// In-page replacements for the browser's confirm()/alert(), which show a generic "The extension says" box.
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
const INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';

function ask({ title, text, ok, danger = false, cancel = true }) {
  const dlg = $('confirm');
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = ok;
  $('confirm-ok').className = danger ? 'danger-solid' : 'primary';
  $('confirm-icon').className = `confirm-icon${danger ? ' danger' : ''}`;
  $('confirm-icon').innerHTML = danger ? TRASH : INFO;
  $('confirm-cancel').hidden = !cancel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
    $(cancel ? 'confirm-cancel' : 'confirm-ok').focus();
  });
}

$('home').onclick = (e) => { e.preventDefault(); selectedId = null; shown = { id: null, sig: '', tab: '' }; $('detail').hidden = true; $('empty').hidden = false; renderList(); };
$('import-2').onclick = () => $('import').click();

function showPane(name) {
  document.querySelectorAll('.dtabs button').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  $('pane-settings').hidden = name !== 'settings';
  $('pane-about').hidden = name !== 'about';
  $('settings-actions').hidden = name === 'about';
  $('about-actions').hidden = name !== 'about';
}
document.querySelectorAll('.dtabs button').forEach((b) => { b.onclick = () => showPane(b.dataset.pane); });
$('settings').addEventListener('close', () => showPane('settings'));

(function fillAbout() {
  $('ver').textContent = `v${chrome.runtime.getManifest().version}`;
  const link = (id, href) => { if (href) { $(id).href = href; $(id).hidden = false; } };
  link('l-site', ABOUT.site);
  link('l-github', ABOUT.github);
  link('l-repo', ABOUT.repo);
  link('l-email', ABOUT.email && `mailto:${ABOUT.email}`);
  if (ABOUT.sponsor && ABOUT.bio) {
    // A native Sponsor card (GitHub refuses to be framed inside an extension page).
    $('sp-card').href = ABOUT.sponsor;
    $('sp-title').textContent = `Sponsor ${ABOUT.name} on GitHub Sponsors`;
    $('sp-bio').textContent = ABOUT.bio;
    if (ABOUT.avatar) $('sp-avatar').src = ABOUT.avatar;
    $('sp-card').hidden = false;
  } else {
    link('l-sponsor', ABOUT.sponsor);
  }
})();
