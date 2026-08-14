// 识别图库第一张图片（无密钥，路由已配置）
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
  await cdp.send('Runtime.enable')
  let opened = await evalJs(cdp, `(() => { if (document.querySelector('.dk-console')) return true; const b = document.querySelector('.dk-footbtn'); if (b) { b.click(); return true } return false })()`)
  for (let a = 0; !opened && a < 3; a++) { await evalJs(cdp, 'location.reload()'); await sleep(12000); opened = await evalJs(cdp, `(() => { if (document.querySelector('.dk-console')) return true; const b = document.querySelector('.dk-footbtn'); if (b) { b.click(); return true } return false })()`) }
  if (!opened) throw new Error('控制台未找到')
  await sleep(4000)
  await evalJs(cdp, `(() => { const t = document.querySelectorAll('.dk-tab'); if (t.length > 2) { t[2].click(); return true } return false })()`)
  await sleep(2500)
  const cards = await evalJs(cdp, `document.querySelectorAll('.dk-media-card').length`)
  console.log('图库卡片数:', cards)
  if (cards === 0) throw new Error('图库为空')
  const name = await evalJs(cdp, `(() => { const n = document.querySelector('.dk-media-name'); return n ? n.textContent : '' })()`)
  console.log('图片名:', name)
  // 点识图
  await evalJs(cdp, `(() => { const b = Array.from(document.querySelectorAll('.dk-btn-sm')).find((x) => x.textContent === '识图'); if (b) { b.click(); return true } return false })()`)
  await sleep(3000)
  const selState = await evalJs(cdp, `(() => { const p = document.querySelectorAll('.dk-vision')[document.querySelectorAll('.dk-vision').length - 1]; if (!p) return null; const sels = p.querySelectorAll('.dk-select'); return { n: sels.length, o1: sels[1] ? sels[1].value : '' } })()`)
  console.log('识图面板:', JSON.stringify(selState))
  // 点识别
  const runClicked = await evalJs(cdp, `(() => { const p = document.querySelectorAll('.dk-vision')[document.querySelectorAll('.dk-vision').length - 1]; const b = p ? Array.from(p.querySelectorAll('.dk-btn')).find((x) => x.textContent.indexOf('识别') >= 0 && !x.disabled) : null; if (b) { b.click(); return true } return false })()`)
  console.log('点击识别:', runClicked)
  let result = ''
  let err = ''
  for (let i = 0; i < 30; i++) {
    await sleep(3000)
    const r = await evalJs(cdp, `(() => { const p = document.querySelectorAll('.dk-vision')[document.querySelectorAll('.dk-vision').length - 1]; if (!p) return { t: '', e: '' }; const ta = p.querySelector('.dk-vision-result'); const er = p.querySelector('.dk-log-err'); return { t: ta ? ta.value : '', e: er ? er.textContent : '' } })()`)
    if (r.t) { result = r.t; break }
    if (r.e) { err = r.e; break }
  }
  if (err) { console.log('识别错误:', err); cdp.close(); process.exit(2) }
  if (!result) { console.log('识别结果为空'); cdp.close(); process.exit(3) }
  console.log('===识别结果===')
  console.log(result)
  cdp.close()
  console.log('===END===')
}
main().catch((e) => { console.error('✗', e.message); process.exit(1) })
