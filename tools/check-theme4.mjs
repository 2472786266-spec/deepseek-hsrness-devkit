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
  console.log('HAS-DOCK:', await ev(`!!document.querySelector('.dk-dock')`));
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-dock .dk-btn-sm')).find((x) => x.textContent.indexOf('工作台') >= 0); if (b) b.click(); return true })()`);
  await sleep(1200);
  console.log('WB-EXISTS:', await ev(`!!document.querySelector('.dk-workbench')`));
  // 模拟 auto 模式：移除所有皮肤 class（Boot 在 auto 下的行为）
  await ev(`(() => { document.body.classList.remove('dk-skin-night','dk-skin-ocean','dk-skin-forest','dk-skin-sunset','dk-skin-graphite'); return true })()`);
  console.log('PANEL-BG:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? getComputedStyle(w).backgroundColor : 'none' })()`));
  console.log('PANEL-COLOR:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? getComputedStyle(w).color : 'none' })()`));
  console.log('OVERLAY-TOKEN:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-overlay').trim()`));
  console.log('LABEL-TOKEN:', await ev(`getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim()`));
  console.log('MATCH:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); const cs = getComputedStyle(w); return cs.backgroundColor === getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-overlay').trim() && cs.color === getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim() })()`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
