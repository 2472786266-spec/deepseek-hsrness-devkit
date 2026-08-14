// v4.0 冒烟测试：原生按钮 + 大弹层
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
    if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
    return r.result ? r.result.value : undefined
  }
  await send('Runtime.enable')
  await send('Page.enable')
  let ok = false
  for (let i = 0; i < 24; i++) {
    if (await ev(`!!document.querySelector('.dk-dock')`)) { ok = true; break }
    await sleep(500)
  }
  console.log('DOCK:', ok ? 'present' : 'MISSING')
  const dock = await ev(`document.querySelector('.dk-dock') ? document.querySelector('.dk-dock').textContent.slice(0, 120) : ''`)
  console.log('DOCKTEXT:', dock)
  const usage = await ev(`document.querySelector('.dk-usage') ? document.querySelector('.dk-usage').textContent : '(无 usage)'`)
  console.log('USAGE:', usage)
  const toolbtns = await ev(`Array.from(document.querySelectorAll('.dk-toolbtn')).map((b) => b.textContent + '|' + b.title).join(' ;; ')`)
  console.log('TOOLBTNS:', toolbtns)
  // 点图库按钮
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-toolbtn')).find((x) => (x.title || '').indexOf('图库') >= 0); if (b) b.click(); return !!b })()`)
  await sleep(1200)
  const gallery = await ev(`document.querySelector('.dk-gallery') ? document.querySelector('.dk-gallery').textContent.slice(0, 300) : '(无图库弹层)'`)
  console.log('GALLERY:', gallery)
  const shot1 = await send('Page.captureScreenshot', { format: 'png' })
  if (shot1 && shot1.data) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync('docs/screenshots/v4-gallery.png', Buffer.from(shot1.data, 'base64'))
    console.log('SHOT v4-gallery.png')
  }
  // 关闭图库，打开监督
  await ev(`(() => { const b = document.querySelector('.dk-gallery .dk-close'); if (b) b.click(); return !!b })()`)
  await sleep(600)
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-toolbtn')).find((x) => (x.title || '').indexOf('监督') >= 0); if (b) b.click(); return !!b })()`)
  await sleep(1200)
  const agents = await ev(`document.querySelector('.dk-agents') ? document.querySelector('.dk-agents').textContent.slice(0, 300) : '(无监督弹层)'`)
  console.log('AGENTS:', agents)
  const shot2 = await send('Page.captureScreenshot', { format: 'png' })
  if (shot2 && shot2.data) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync('docs/screenshots/v4-agents.png', Buffer.from(shot2.data, 'base64'))
    console.log('SHOT v4-agents.png')
  }
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
