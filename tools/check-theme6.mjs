const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.j(new Error(m.error.message)) : q.r(m.result); } };
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };
  await send('Runtime.enable');
  console.log('LAYER1:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim()`));
  console.log('MATCH-LAYER1:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); if (!w) return 'no-wb'; const cs = getComputedStyle(w); return cs.backgroundColor === getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim() })()`));
  console.log('BRAND:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-brand-primary').trim()`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
