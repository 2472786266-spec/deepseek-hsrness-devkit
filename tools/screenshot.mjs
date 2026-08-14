// DSH DevKit 截图工具：通过 CDP 驱动无头 Edge 截取开发控制台面板
// 用法：
//   1) 启动无头浏览器:
//      msedge --headless=new --disable-gpu --remote-debugging-port=9222 \
//             --user-data-dir=<临时目录> --window-size=1440,900 --no-first-run about:blank
//   2) 运行:  node tools/screenshot.mjs   （可选环境变量 DEMO_IMG 指定演示图路径）
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PORT = 9222
const BASE = 'http://127.0.0.1:3080'
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots')
const DEMO_IMG = process.env.DEMO_IMG || ''
const SESSION_ID = process.env.DSH_SESSION_ID || ''

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getPage() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page')
      if (page) return page
    } catch (e) { /* 浏览器尚未就绪 */ }
    await sleep(1000)
  }
  throw new Error('无法连接无头浏览器调试端口 ' + PORT)
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
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
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
  if (r.exceptionDetails) throw new Error('页面脚本执行失败: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r.result ? r.result.value : undefined
}

async function shot(cdp, file) {
  const rect = await evalJs(cdp, `(() => { const el = document.querySelector('.dk-console'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.max(0, Math.round(r.x)), y: Math.max(0, Math.round(r.y)), width: Math.round(r.width), height: Math.round(r.height) } })()`)
  if (!rect || rect.width < 60) throw new Error('控制台面板不可见')
  const data = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 }, fromSurface: true })
  writeFileSync(file, Buffer.from(data.data, 'base64'))
  console.log('✓ saved', file, '(' + rect.width + 'x' + rect.height + ')')
}

async function clickTab(cdp, index) {
  const ok = await evalJs(cdp, `(() => { const tabs = document.querySelectorAll('.dk-tab'); if (tabs.length > ${index}) { tabs[${index}].click(); return true } return false })()`)
  if (!ok) throw new Error('标签页 #' + index + ' 不存在')
  await sleep(2000)
}

async function main() {
  const page = await getPage()
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  console.log('→ 确认页面状态')
  const href = await evalJs(cdp, `location.href`)
  if (!href || !href.startsWith(BASE)) {
    console.log('→ 打开页面', BASE)
    await cdp.send('Page.navigate', { url: BASE })
    await sleep(12000)
  }

  if (SESSION_ID) {
    const current = await evalJs(cdp, `(() => { try { return localStorage.getItem('dsh.sessions.current') || '' } catch (e) { return '' } })()`)
    if (current && !current.includes(SESSION_ID)) {
      console.log('→ 切换到目标会话', SESSION_ID)
      await evalJs(cdp, `(() => { localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: ${JSON.stringify(SESSION_ID)} })); location.reload(); return true })()`)
      await sleep(14000)
    }
  }

  console.log('→ 打开控制台')
  let opened = await evalJs(cdp, `(() => { const b = document.querySelector('.dk-footbtn'); if (b) { b.click(); return true } return false })()`)
  for (let attempt = 0; !opened && attempt < 3; attempt++) {
    console.log('  未找到入口，重载页面重试 (' + (attempt + 1) + '/3)')
    await evalJs(cdp, `(() => { location.reload(); return true })()`)
    await sleep(14000)
    opened = await evalJs(cdp, `(() => { const b = document.querySelector('.dk-footbtn'); if (b) { b.click(); return true } return false })()`)
  }
  if (!opened) throw new Error('未找到控制台入口按钮（.dk-footbtn）')
  await sleep(4500)

  console.log('→ 截图：智能体标签页')
  await shot(cdp, join(OUT_DIR, 'console-agents.png'))

  console.log('→ 切到图库并导入演示图')
  await clickTab(cdp, 2)
  if (DEMO_IMG) {
    const typed = await evalJs(cdp, `(() => { const input = document.querySelector('.dk-pathinput'); if (!input) return 'no-input'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(DEMO_IMG)}); input.dispatchEvent(new Event('input', { bubbles: true })); return 'ok' })()`)
    console.log('  输入路径:', typed)
    await sleep(600)
    await evalJs(cdp, `(() => { const btns = document.querySelectorAll('.dk-uploadrow .dk-btn'); if (btns.length) { btns[btns.length - 1].click(); return true } return false })()`)
    await sleep(5000)
  }
  await shot(cdp, join(OUT_DIR, 'console-media.png'))

  console.log('→ 截图：任务标签页')
  await clickTab(cdp, 1)
  await shot(cdp, join(OUT_DIR, 'console-jobs.png'))

  console.log('→ 截图：工作流标签页')
  await clickTab(cdp, 3)
  await shot(cdp, join(OUT_DIR, 'console-workflows.png'))

  console.log('→ 截图：目标标签页')
  await clickTab(cdp, 4)
  await shot(cdp, join(OUT_DIR, 'console-goal.png'))

  if (DEMO_IMG) {
    console.log('→ 清理演示图')
    await clickTab(cdp, 2)
    await evalJs(cdp, `(() => { const b = document.querySelector('.dk-media-actions .dk-btn-danger'); if (b) { b.click(); return true } return false })()`)
    await sleep(1500)
  }

  cdp.close()
  console.log('完成')
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
