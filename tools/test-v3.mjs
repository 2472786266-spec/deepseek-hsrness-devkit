// v3.0 冒烟测试：验证 dock 令牌统计、变更(SCM)页签、文件页签，并截图
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function getPage() {
  for (let i = 0; i < 40; i++) {
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
  if (r.exceptionDetails) return { error: JSON.stringify(r.exceptionDetails).slice(0, 400) }
  return r.result ? r.result.value : undefined
}
const waitFor = async (cdp, expr, timeout = 20000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const v = await evalJs(cdp, expr)
    if (v) return v
    await sleep(500)
  }
  return null
}
async function shot(cdp, path) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
  if (r && r.data) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, Buffer.from(r.data, 'base64'))
    console.log('SHOT', path)
  }
}
async function main() {
  const page = await getPage()
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  const dock = await waitFor(cdp, `(() => { const d = document.querySelector('.dk-dock'); return d ? d.textContent.slice(0, 300) : '' })()`)
  console.log('DOCK:', dock)
  const usage = await evalJs(cdp, `(() => { const u = document.querySelector('.dk-dockusage'); return u ? u.textContent : '(无令牌统计条)' })()`)
  console.log('USAGE:', usage)

  // 打开控制台
  await evalJs(cdp, `(() => { const b = document.querySelector('.dk-dock button'); if (b) b.click(); return true })()`)
  await waitFor(cdp, `(() => { const c = document.querySelector('.dk-console'); return c ? c.offsetParent !== null : false })()`)
  const tabs = await evalJs(cdp, `(() => Array.from(document.querySelectorAll('.dk-tab')).map((t) => t.textContent).join('|'))()`)
  console.log('TABS:', tabs)

  const clickTab = async (label) => {
    await evalJs(cdp, `(() => { const t = Array.from(document.querySelectorAll('.dk-tab')).find((x) => x.textContent === ${JSON.stringify(label)}); if (t) t.click(); return !!t })()`)
    await sleep(1500)
  }
  await clickTab('变更')
  const scmText = await evalJs(cdp, `(() => { const b = document.querySelector('.dk-body'); return b ? b.textContent.slice(0, 400) : '' })()`)
  console.log('SCM:', scmText)
  await shot(cdp, 'docs/screenshots/console-scm.png')

  await clickTab('文件')
  const fileText = await evalJs(cdp, `(() => { const b = document.querySelector('.dk-body'); return b ? b.textContent.slice(0, 400) : '' })()`)
  console.log('FILES:', fileText)
  await shot(cdp, 'docs/screenshots/console-files.png')

  await clickTab('任务')
  const jobText = await evalJs(cdp, `(() => { const b = document.querySelector('.dk-body'); return b ? b.textContent.slice(0, 300) : '' })()`)
  console.log('JOBS:', jobText)
  await shot(cdp, 'docs/screenshots/console-jobs-v3.png')

  // 换肤测试
  await evalJs(cdp, `(() => { const sel = document.querySelector('.dk-skinselect'); if (sel) { sel.value = 'night'; sel.dispatchEvent(new Event('change', { bubbles: true })) } return true })()`)
  await sleep(800)
  const skinClass = await evalJs(cdp, `(() => { try { return document.body.className } catch (e) { return '' } })()`)
  console.log('SKIN:', skinClass)
  await shot(cdp, 'docs/screenshots/console-skin-night.png')

  cdp.close()
}
main().catch((e) => { console.error('✗', e.message); process.exit(1) })
