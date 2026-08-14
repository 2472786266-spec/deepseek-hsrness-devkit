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
  // 打开监督面板检查 depth/age/goal 元素
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-toolbtn')).find((x) => x.title.indexOf('智能体监督') >= 0); if (b) b.click(); return true })()`);
  await sleep(1500);
  console.log('DEPTH-ELS:', await ev(`document.querySelectorAll('.dk-depth').length`));
  console.log('AGE-ELS:', await ev(`document.querySelectorAll('.dk-age').length`));
  console.log('GOAL-ELS:', await ev(`document.querySelectorAll('.dk-goalline').length`));
  console.log('OPEN-BTNS:', await ev(`Array.from(document.querySelectorAll('.dk-btn-sm')).filter((b) => b.textContent === '打开').length`));
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
