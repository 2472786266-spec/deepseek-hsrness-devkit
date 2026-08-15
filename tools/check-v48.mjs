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
  console.log('DOCK:', await ev(`!!document.querySelector('.dk-dock')`));
  console.log('VER:', await ev(`(() => { const v = document.querySelector('.dk-ver'); return v ? v.textContent : 'none' })()`));
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-dock .dk-btn-sm')).find((x) => x.textContent.indexOf('工作台') >= 0); if (b) b.click(); return true })()`);
  await sleep(1500);
  console.log('WORKBENCH-BG:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? getComputedStyle(w).backgroundColor : 'none' })()`));
  console.log('LAYER1-TOKEN:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-layer-1').trim()`));
  console.log('TAB-COLOR:', await ev(`(() => { const t = document.querySelector('.dk-tab'); return t ? getComputedStyle(t).color : 'none' })()`));
  console.log('TAB-ACTIVE-COLOR:', await ev(`(() => { const t = document.querySelector('.dk-tab-active'); return t ? getComputedStyle(t).color : 'none' })()`));
  console.log('STATUS-COLOR:', await ev(`(() => { const s = document.querySelector('.dk-status'); return s ? getComputedStyle(s).color : 'none' })()`));
  console.log('SECONDARY-TOKEN:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-secondary').trim()`));
  console.log('PRIMARY-TOKEN:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim()`));
  await ev(`(() => { const w = document.querySelector('.dk-workbench'); if (w && w.querySelector('.dk-close')) w.querySelector('.dk-close').click(); return true })()`);
  console.log('CLOSED:', await ev(`!document.querySelector('.dk-workbench')`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
