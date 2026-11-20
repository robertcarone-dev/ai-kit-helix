// Installed at document start. This bridge only talks to the owned preview frame
// (or observes its own document in direct mode); it never connects to a user tab.
(() => {
  const state = { clientDocumentId: crypto.randomUUID(), documentId: null, nonce: null, servedAt: null, project: null, generation: 0, heldReloadPending: false, heldSince: null, trigger: null, release: null, ready: false, capabilities: {} };
  const pending = new Map();
  const target = () => document.getElementById('helix-cli-preview')?.contentWindow ?? window;
  function cancel(reason) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error(reason)); }
    pending.clear();
  }
  window.addEventListener('message', (event) => {
    if (event.source !== target()) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'helix:document' && typeof msg.docId === 'string') {
      if (msg.docId !== state.documentId || (msg.nonce && msg.nonce !== state.nonce)) {
        cancel('Preview document changed during command; do not replay a mutating command automatically.');
        Object.assign(state, { documentId: msg.docId, nonce: msg.nonce ?? null, servedAt: msg.servedAt, project: msg.project, generation: state.generation + 1, heldReloadPending: false, heldSince: null, trigger: null, release: null, ready: false, capabilities: {} });
      }
      return;
    }
    if (msg.docId && msg.docId !== state.documentId) return;
    if (msg.nonce && state.nonce && msg.nonce !== state.nonce) return;
    if (msg.type === 'helix:ready') {
      state.ready = true;
      state.capabilities = msg.capabilities;
    }
    if (msg.type === 'helix:held') {
      state.heldReloadPending = true;
      state.heldSince ??= Date.now();
      state.trigger = msg.trigger;
    }
    if (msg.type === 'helix:release') {
      state.release = msg.reason;
      cancel('Preview requires a reload: ' + msg.reason + '. Reset and restage the scenario.');
    }
    const entry = pending.get(msg.requestId);
    if (entry && entry.reply === msg.type) {
      clearTimeout(entry.timer);
      pending.delete(msg.requestId);
      entry.resolve(msg);
    }
  });
  window.__helixCliPreview = {
    reading: () => ({ ...state, heldForMs: state.heldSince === null ? null : Date.now() - state.heldSince }),
    request({ type, reply, capability, args, timeoutMs }) {
      if (target() === window) throw new Error('Native preview commands require start --preview native.');
      if (!state.ready || state.capabilities[capability] !== true) throw new Error('Preview does not advertise capability: ' + capability);
      if (state.release !== null) throw new Error('Preview requires reset: ' + state.release);
      const requestId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('Native preview command timed out; its action may have run. Reset before retrying.'));
        }, timeoutMs);
        pending.set(requestId, { reply, resolve, reject, timer });
        target().postMessage({ ...args, type, requestId }, '*');
      });
    },
  };
  window.addEventListener('pagehide', () => cancel('Preview page closed during command.'));
})();
