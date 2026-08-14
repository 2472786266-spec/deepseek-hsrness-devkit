// 快速查看当前 dock 与令牌统计状态
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function main() {
  let page
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      page = list.find((t) => t.type === 'page')
      if (page) break
    } catch (e) {}
    await sleep(1000)
  }
  if (!page) throw new Error('no page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')) })
  const send = (m, p = {}) => new Promise((res, rej) => {
    const i = ++id
    pending.set(i, { res, rej })
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id)
      pending.delete(m.id)
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
    }
  }
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
    return r.result ? r.result.value : undefined
  }
  await send('Runtime.enable')
  const dock = await ev(`(() => { const d = document.querySelector('.dk-dock'); return d ? d.textContent : '(无 dock)' })()`)
  const usage = await ev(`(() => { const u = document.querySelector('.dk-dockusage'); return u ? u.textContent : '(无 usage 元素)' })()`)
  console.log('DOCK:', dock)
  console.log('USAGE:', usage)
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
