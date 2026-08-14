// 清理粘贴测试产生的图片
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
  // 图库可能已关闭；先打开再清理
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-btn-sm')).find((x) => x.textContent.indexOf('图库') >= 0 && x.closest('.dk-dock')); if (b) b.click(); return true })()`)
  await sleep(1200)
  const result = await ev(`(() => {
    const cards = Array.from(document.querySelectorAll('.dk-media-card'))
    const target = cards.find((c) => { const n = c.querySelector('.dk-media-name'); return n && n.textContent === 'paste-smoke-test.png' })
    if (!target) return 'not-found'
    const btn = Array.from(target.querySelectorAll('.dk-btn-sm')).find((b) => b.textContent === '删除')
    if (!btn) return 'no-delete-btn'
    btn.click()
    return 'delete-clicked'
  })()`)
  console.log('CLEANUP:', result)
  await sleep(1500)
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
