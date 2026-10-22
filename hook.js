// Runs inside meet.google.com's own JS world (manifest "world": "MAIN") at document_start.
// It only watches Meet's WebRTC connections to detect when a call starts and ends, and tells content.js.
(() => {
  if (window.__recapHook) return;
  window.__recapHook = true;

  const pcs = new Set();
  let inCall = false;
  let endTimer = null;
  const post = (type) => window.postMessage({ source: 'recap-hook', type }, '*');

  const anyConnected = () => [...pcs].some((pc) => pc.connectionState === 'connected');

  function checkCall() {
    for (const pc of pcs) if (pc.connectionState === 'closed') pcs.delete(pc);
    if (anyConnected()) {
      clearTimeout(endTimer);
      endTimer = null;
      if (!inCall) { inCall = true; post('call-started'); }
    } else if (inCall && !endTimer) {
      // Debounce: Meet briefly reconnects during network blips, so only a sustained drop ends the call.
      endTimer = setTimeout(() => {
        endTimer = null;
        if (!anyConnected()) { inCall = false; post('call-ended'); }
      }, 8000);
    }
  }

  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection']) {
    const Native = window[name];
    if (!Native) continue;
    const Wrapped = function (...args) {
      const pc = new Native(...args);
      pcs.add(pc);
      pc.addEventListener('connectionstatechange', checkCall);
      // close() fires no state-change event, and that is how a call normally ends.
      const nativeClose = pc.close.bind(pc);
      pc.close = () => { nativeClose(); checkCall(); };
      return pc;
    };
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window[name] = Wrapped;
  }

  setInterval(checkCall, 1000); // backstop for state changes that fire no event
})();
