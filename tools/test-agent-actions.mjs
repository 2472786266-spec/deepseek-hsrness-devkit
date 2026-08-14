// v4.5.2 端到端测试：工作台内「发消息」与「打开」真实动作
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
  // 打开工作台
  await ev(`(() => { const b = Array.from(document.querySelectorAll('.dk-dock .dk-btn-sm')).find((x) => x.textContent.indexOf('工作台') >= 0); if (b) b.click(); return true })()`)
  await sleep(1500)
  console.log('WORKBENCH:', await ev(`document.querySelector('.dk-workbench') ? 'open' : 'closed'`))
  const rows = await ev(`(() => Array.from(document.querySelectorAll('.dk-workbench .dk-agentrow')).map((r) => r.textContent.slice(0, 60)).join(' || '))()`)
  console.log('ROWS:', rows)
  // 发消息：找第一个带「发消息」按钮的非主会话行
  const clickMsg = await ev(`(() => {
    const rows = Array.from(document.querySelectorAll('.dk-workbench .dk-agentrow'))
    const target = rows.find((r) => Array.from(r.querySelectorAll('.dk-btn-sm')).some((b) => b.textContent === '发消息'))
    if (!target) return 'no-target'
    const btn = Array.from(target.querySelectorAll('.dk-btn-sm')).find((b) => b.textContent === '发消息')
    btn.click()
    return 'clicked'
  })()`)
  console.log('CLICK-MSG:', clickMsg)
  if (clickMsg === 'clicked') {
    await sleep(600)
    await ev(`(() => {
      const ta = document.querySelector('.dk-workbench .dk-msgform textarea')
      if (!ta) return 'no-textarea'
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '（开发套件联通测试）这是一条自动测试消息，请忽略，无需执行任何任务。')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return 'typed'
    })()`)
    await sleep(400)
    await ev(`(() => { const b = document.querySelector('.dk-workbench .dk-msgform .dk-btn-primary'); if (b) b.click(); return true })()`)
    await sleep(3000)
    console.log('SEND-RESULT:', await ev(`(() => { const n = document.querySelector('.dk-workbench .dk-msgform .dk-note'); return n ? n.textContent : '(无反馈)' })()`))
  }
  // 打开：记录 URL，点击第一个子智能体的「打开」，观察导航
  const hrefBefore = await ev(`location.href`)
  const clickOpen = await ev(`(() => {
    const rows = Array.from(document.querySelectorAll('.dk-workbench .dk-agentrow'))
    const target = rows.find((r) => Array.from(r.querySelectorAll('.dk-btn-sm')).some((b) => b.textContent === '打开'))
    if (!target) return 'no-target'
    const btn = Array.from(target.querySelectorAll('.dk-btn-sm')).find((b) => b.textContent === '打开')
    btn.click()
    return 'clicked'
  })()`)
  console.log('CLICK-OPEN:', clickOpen)
  await sleep(2000)
  const hrefAfter = await ev(`location.href`)
  console.log('OPEN-NAVIGATED:', hrefBefore !== hrefAfter ? 'YES (' + hrefAfter.slice(0, 90) + ')' : 'NO (href unchanged)')
  console.log('OPEN-HINT:', await ev(`(() => { const n = document.querySelector('.dk-dock .dk-note'); return n ? n.textContent.slice(0, 240) : '(无提示)' })()`))
  // 导航回原会话
  if (hrefBefore !== hrefAfter) {
    await send('Page.navigate', { url: hrefBefore })
    await sleep(3000)
    console.log('BACK:', await ev(`!!document.querySelector('.dk-dock')`))
  }
  ws.close()
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
