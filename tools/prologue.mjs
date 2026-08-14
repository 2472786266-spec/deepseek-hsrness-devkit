// 前置：导航到 DSH 并切换到目标会话（供插件重启时注入客户端包）
const PORT = 9222
const BASE = 'http://127.0.0.1:3080'
const SESSION_ID = process.env.DSH_SESSION_ID || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getPage() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch (e) {}
    await sleep(1000)
  }
  throw new Error('no debug target')
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        const i = ++id
        pending.set(i, { res, rej })
        ws.send(JSON.stringify({ id: i, method, params }))
      }),
      close: () => ws.close(),
    })
    ws.onerror = () => reject(new Error('ws error'))
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        m.error ? p.rej(new Error(m.error.message)) : p.res(m.result)
      }
    }
  })
}
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 300) }
  return r.result ? r.result.value : undefined
}
async function main() {
  const page = await getPage()
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  const href = await evalJs(cdp, 'location.href')
  if (!href || !href.startsWith(BASE)) {
    await cdp.send('Page.navigate', { url: BASE })
    await sleep(12000)
  }
  if (SESSION_ID) {
    const cur = await evalJs(cdp, `(() => { try { return localStorage.getItem('dsh.sessions.current') || '' } catch (e) { return '' } })()`)
    if (cur && !cur.includes(SESSION_ID)) {
      await evalJs(cdp, `(() => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(SESSION_ID)} })); location.reload(); return true })()`)
      await sleep(14000)
    }
  }
  console.log('PAGE_READY', await evalJs(cdp, 'document.title'))
  cdp.close()
}
main().catch((e) => { console.error('✗', e.message); process.exit(1) })
