// 诊断无头浏览器中的 DSH 页面状态
import { fileURLToPath } from 'node:url'

const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getPage() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch (e) {}
    await sleep(1000)
  }
  throw new Error('无法连接调试端口')
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
  await cdp.send('Runtime.enable')
  const info = await evalJs(cdp, `(() => {
    const out = { url: location.href, title: document.title }
    out.hasFootbtn = !!document.querySelector('.dk-footbtn')
    out.hasConsole = !!document.querySelector('.dk-console')
    out.hasDock = !!document.querySelector('.dk-dock')
    out.bodyText = (document.body ? document.body.innerText : '').slice(0, 600)
    try {
      const ls = {}
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = String(localStorage.getItem(k)).slice(0, 200) }
      out.localStorage = ls
    } catch (e) { out.localStorage = 'n/a' }
    return out
  })()`)
  console.log(JSON.stringify(info, null, 2))
  cdp.close()
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
