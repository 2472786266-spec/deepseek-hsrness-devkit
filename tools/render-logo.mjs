import fs from 'node:fs'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const svgB64 = fs.readFileSync('C:/Users/Admin/Desktop/deepseek-Hsrness/dsh-devkit/assets/dsh-logo.svg', 'base64');
  const res = await fetch('http://127.0.0.1:9222/json/list');
  const list = await res.json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
  const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pending.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const q = pending.get(m.id); pending.delete(m.id); m.error ? q.j(new Error(m.error.message)) : q.r(m.result); } };
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(800);
  const expr = `(async () => {
    const svgText = atob('${svgB64}');
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('img load fail')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(img, 0, 0, 256, 256);
    return c.toDataURL('image/png');
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const dataUrl = r.result.value;
  const b64 = dataUrl.split(',')[1];
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync('C:/Users/Admin/Desktop/deepseek-Hsrness/dsh-devkit/assets/dsh-logo.png', buf);
  console.log('PNG bytes:', buf.length);
  ws.close();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
