// v4.4 粘贴链路测试：合成 ClipboardEvent 携带 PNG 文件，验证自动上传+打开识图
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
    if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
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
  const before = await ev(`(() => { const d = document.querySelector('.dk-dockstats'); return d ? d.textContent : '' })()`)
  console.log('BEFORE:', before)
  // 合成粘贴事件：最小 PNG（8 字节魔数 + 填充）
  const dispatch = await ev(`(() => {
    try {
      const bytes = new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])
      const file = new File([bytes], 'paste-smoke-test.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
      window.dispatchEvent(e)
      return 'dispatched'
    } catch (err) { return 'ERR ' + String(err) }
  })()`)
  console.log('DISPATCH:', dispatch)
  await sleep(3000)
  const gallery = await ev(`document.querySelector('.dk-gallery') ? 'gallery-open' : 'gallery-closed'`)
  const vision = await ev(`document.querySelector('.dk-vision') ? 'vision-open' : 'vision-closed'`)
  const hint = await ev(`(() => { const d = document.querySelector('.dk-dock .dk-note'); return d ? d.textContent : '' })()`)
  const after = await ev(`(() => { const d = document.querySelector('.dk-dockstats'); return d ? d.textContent : '' })()`)
  console.log('GALLERY:', gallery, '| VISION:', vision, '| HINT:', hint)
  console.log('AFTER:', after)
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
