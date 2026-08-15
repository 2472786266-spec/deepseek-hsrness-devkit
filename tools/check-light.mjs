const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page' && t.url.indexOf('3080') >= 0);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.j(new Error(m.error.message)) : q.r(m.result); } };
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result ? r.result.value : undefined; };
  await send('Runtime.enable');
  // 模拟亮色主题变量
  await ev(`(() => { const b = document.body; const v = {'--dsw-alias-bg-base':'#ffffff','--dsw-alias-bg-layer-1':'#f6f7f9','--dsw-alias-bg-layer-2':'#eceef2','--dsw-alias-bg-overlay':'#ffffff','--dsw-alias-label-primary':'#1b1d22','--dsw-alias-label-secondary':'#6b7280','--dsw-alias-brand-primary':'#4f8cff','--dsw-alias-state-error-primary':'#ef4444','--dsw-alias-state-success-primary':'#16a34a','--dsw-alias-state-warn-primary':'#b45309','--dsw-alias-border-l1':'rgba(110,120,140,.25)','--dsw-alias-border-l2':'rgba(110,120,140,.35)'}; for (const k in v) b.style.setProperty(k, v[k]); return true })()`);
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-dock .dk-btn-sm')).find((x) => x.textContent.indexOf('工作台') >= 0); if (b) b.click(); return true })()`);
  await sleep(1500);
  console.log('WB-BG:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? getComputedStyle(w).backgroundColor : 'none' })()`));
  console.log('WB-COLOR:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? getComputedStyle(w).color : 'none' })()`));
  console.log('TAB-INACTIVE:', await ev(`(() => { const t = Array.from(document.querySelectorAll('.dk-tab')).find((x) => !x.className.includes('active')); return t ? getComputedStyle(t).color : 'none' })()`));
  console.log('TAB-ACTIVE:', await ev(`(() => { const t = document.querySelector('.dk-tab-active'); return t ? getComputedStyle(t).backgroundColor + ' / ' + getComputedStyle(t).color : 'none' })()`));
  console.log('STATUS:', await ev(`(() => { const s = document.querySelector('.dk-status'); return s ? getComputedStyle(s).color : 'none' })()`));
  console.log('TIP:', await ev(`(() => { const t = document.querySelector('.dk-tip'); return t ? getComputedStyle(t).color : 'none' })()`));
  console.log('HEAD-BG:', await ev(`(() => { const h = document.querySelector('.dk-workbench .dk-panel-head'); return h ? getComputedStyle(h).backgroundColor : 'none' })()`));
  console.log('BTN-SM:', await ev(`(() => { const b = document.querySelector('.dk-btn-sm'); return b ? getComputedStyle(b).backgroundColor + '/' + getComputedStyle(b).color : 'none' })()`));
  console.log('BTN-PRIMARY:', await ev(`(() => { const b = document.querySelector('.dk-btn-primary'); return b ? getComputedStyle(b).backgroundColor + '/' + getComputedStyle(b).color : 'none' })()`));
  console.log('WB-HEIGHT:', await ev(`(() => { const w = document.querySelector('.dk-workbench'); return w ? Math.round(w.getBoundingClientRect().height) + 'px / vh=' + window.innerHeight : 'none' })()`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
