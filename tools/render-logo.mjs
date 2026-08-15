import fs from 'node:fs'
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
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 256, height: 256, deviceScaleFactor: 1, mobile: false });
  const fileUrl = 'file:///C:/Users/Admin/Desktop/deepseek-Hsrness/dsh-devkit/assets/dsh-logo.svg';
  await send('Page.navigate', { url: fileUrl });
  await sleep(2500);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(shot.data, 'base64');
  fs.writeFileSync('C:/Users/Admin/Desktop/deepseek-Hsrness/dsh-devkit/assets/dsh-logo.png', buf);
  console.log('PNG bytes:', buf.length);
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
