// SCM 专项复测：变更页签应显示 dsh-devkit 仓库状态
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
  let ok = false
  for (let i = 0; i < 24; i++) {
    if (await ev(`!!document.querySelector('.dk-dock')`)) { ok = true; break }
    await sleep(500)
  }
  console.log('DOCK:', ok ? 'present' : 'MISSING')
  await ev(`(() => { const b = document.querySelector('.dk-dock button'); if (b) b.click(); return true })()`)
  for (let i = 0; i < 16; i++) {
    if (await ev(`(() => { const c = document.querySelector('.dk-console'); return c && c.offsetParent !== null })()`)) break
    await sleep(500)
  }
  await ev(`(() => { const t = Array.from(document.querySelectorAll('.dk-tab')).find((x) => x.textContent === '变更'); if (t) t.click(); return true })()`)
  await sleep(2500)
  const body = await ev(`document.querySelector('.dk-body') ? document.querySelector('.dk-body').textContent.slice(0, 600) : '(无 body)'`)
  console.log('SCM:', body)
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
