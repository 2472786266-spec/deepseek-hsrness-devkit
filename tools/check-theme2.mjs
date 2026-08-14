const PORT = 9222;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.j(new Error(m.error.message)) : q.r(m.result); } };
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };
  await send('Runtime.enable');
  console.log('BODY-VARS:', await ev(`(() => { const cs = getComputedStyle(document.body); return ['bg-base','bg-overlay','label-primary'].map((k) => k + '=' + cs.getPropertyValue('--dsw-alias-' + k).trim()).join(' | ') })()`));
  console.log('APP-VARS:', await ev(`(() => { const app = document.querySelector('#root, .app, main, [data-theme]') || document.body.firstElementChild; if (!app) return 'no-app'; const cs = getComputedStyle(app); return ['bg-base','bg-overlay','label-primary'].map((k) => k + '=' + cs.getPropertyValue('--dsw-alias-' + k).trim()).join(' | ') })()`));
  console.log('VAR-HOST:', await ev(`(() => { let found = null; const walk = (n, d) => { if (found || d > 4) return; const cs = getComputedStyle(n); const v = cs.getPropertyValue('--dsw-alias-bg-overlay').trim(); if (v) { found = n.tagName + '.' + (n.className && typeof n.className === 'string' ? n.className.split(' ').slice(0,2).join('.') : '') + '=' + v; return; } for (const c of n.children || []) walk(c, d + 1); }; walk(document.body, 0); return found || 'not-found-in-4-levels' })()`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
