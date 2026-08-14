// v4.2 冒烟测试：侧边栏工作台按钮 + 停靠面板
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
  // 侧边栏底部工作台按钮
  const wbBtn = await ev(`(() => { const b = document.querySelector('.dk-footbtn'); return b ? b.textContent + '|' + b.title : '(无工作台按钮)' })()`)
  console.log('WORKBENCH-BTN:', wbBtn)
  if (await ev(`!!document.querySelector('.dk-footbtn')`)) {
    await ev(`document.querySelector('.dk-footbtn').click()`)
    await sleep(1000)
  }
  const wb = await ev(`document.querySelector('.dk-workbench') ? document.querySelector('.dk-workbench').textContent.slice(0, 320) : '(无工作台面板)'`)
  console.log('WORKBENCH:', wb)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  if (shot && shot.data) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync('docs/screenshots/v4-workbench.png', Buffer.from(shot.data, 'base64'))
    console.log('SHOT v4-workbench.png')
  }
  // Esc 关闭
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await sleep(600)
  const closed = await ev(`document.querySelector('.dk-workbench') ? 'still-open' : 'closed'`)
  console.log('WORKBENCH-AFTER-ESC:', closed)
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
