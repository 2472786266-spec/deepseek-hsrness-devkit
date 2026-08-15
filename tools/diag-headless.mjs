const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page' && t.url.indexOf('3080') >= 0);
  if (!page) { console.log('NO-PAGE'); return; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.j(new Error(m.error.message)) : q.r(m.result); } };
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };
  await send('Runtime.enable');
  console.log('URL:', await ev(`location.href`));
  console.log('HAS-DOCK:', await ev(`!!document.querySelector('.dk-dock')`));
  console.log('HAS-DK-VAR:', await ev(`(() => { const r = document.documentElement; return r.style.getPropertyValue('--dk-bg') || 'EMPTY' })()`));
  console.log('STYLE-COUNT:', await ev(`document.querySelectorAll('style').length`));
  console.log('DKCSS-PRESENT:', await ev(`(() => Array.from(document.querySelectorAll('style')).some((s) => (s.textContent||'').indexOf('--dk-bg') >= 0))()`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
