// DSH DevKit · Client half (browser)
// 用法：把本文件内容作为 cordis_define 的 code.client（内容本身即函数体）。
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const el = React.createElement

    const store = { open: false, tab: 'agents', state: null, connected: false, lastError: '', pendingInsert: null, insertHint: '', pos: null, dragging: null }
    const listeners = new Set()
    const emit = () => { for (const fn of listeners) { try { fn() } catch (e) {} } }
    const patch = (p) => { Object.assign(store, p); emit() }
    const useStore = () => {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        const fn = () => force((v) => v + 1)
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      }, [])
      return store
    }
    const mediaCache = new Map()

    const refresh = async () => {
      try {
        const res = await host.call('state', {})
        if (res && res.ok && res.state) patch({ state: res.state, connected: true, lastError: '' })
        else patch({ lastError: res && res.error ? String(res.error) : '状态读取失败' })
      } catch (e) { patch({ lastError: String((e && e.message) || e) }) }
    }

    const tryInsertText = (inputActions, text) => {
      if (!inputActions) return false
      const attempts = [
        (a) => { if (typeof a.setText === 'function') { a.setText(text); return true } return false },
        (a) => { if (typeof a.set === 'function') { a.set(text); return true } return false },
        (a) => { if (typeof a.update === 'function') { a.update({ text: text }); return true } return false },
        (a) => { if (typeof a.appendText === 'function') { a.appendText(text); return true } return false },
        (a) => { if (typeof a.insert === 'function') { a.insert(text); return true } return false },
      ]
      for (const attempt of attempts) {
        try { if (attempt(inputActions)) return true } catch (e) {}
      }
      return false
    }

    const refTextOf = (entry) => {
      if (!entry) return ''
      if (entry.realPath) return '请查看图片: ' + entry.realPath
      return '请查看图库图片“' + entry.name + '”（引用 devkit:' + entry.ref + '，base64 保存在工作区 .dsh-media-' + entry.ref + '.txt，请先用 pwsh 解码为 .png 再 read_image 查看分析）'
    }

    const STATUS_META = {
      running: { label: '运行中', cls: 'dk-dot-running' },
      idle: { label: '空闲', cls: 'dk-dot-idle' },
      ready: { label: '就绪(可唤醒)', cls: 'dk-dot-ready' },
      ended: { label: '已结束', cls: 'dk-dot-ended' },
      unknown: { label: '未知', cls: 'dk-dot-unknown' },
    }
    const StatusBadge = (status) => {
      const meta = STATUS_META[status] || STATUS_META.unknown
      return el('span', { className: 'dk-status' }, el('span', { className: 'dk-dot ' + meta.cls }), meta.label)
    }

    function AgentRow(props) {
      const agent = props.agent
      const [openMsg, setOpenMsg] = React.useState(false)
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const canInterrupt = agent.status === 'running'
      const send = async () => {
        if (!text.trim()) return
        setBusy(true); setNote('发送中…')
        try {
          const res = await host.call('agent-message', { agentId: agent.id, text: text })
          setNote(res && res.ok ? '已送达 ✓' : '失败: ' + (res && res.error ? res.error : '未知'))
          if (res && res.ok) { setText(''); setOpenMsg(false) }
        } catch (e) { setNote('发送失败') }
        setBusy(false)
      }
      const stop = async () => {
        try {
          const res = await host.call('agent-interrupt', { agentId: agent.id })
          setNote(res && res.ok ? '已发出打断 ✓' : '失败: ' + (res && res.error ? res.error : '未知'))
        } catch (e) { setNote('打断失败') }
      }
      return el('div', { className: 'dk-agentrow' },
        StatusBadge(agent.status),
        el('div', { className: 'dk-agentname', title: agent.id }, (agent.isRoot ? '★ ' : '') + agent.label, el('span', { className: 'dk-mono' }, ' ' + String(agent.id || '').slice(0, 12))),
        el('div', { className: 'dk-agentactions' },
          el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => { setOpenMsg(!openMsg); setNote('') } }, openMsg ? '收起' : '发消息'),
          canInterrupt ? el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: stop }, '打断') : null,
        ),
        openMsg ? el('div', { className: 'dk-msgform' },
          el('textarea', { className: 'dk-input dk-textarea', rows: 2, placeholder: '发送给该智能体的新消息…（作为它的下一轮）', value: text, onChange: (ev) => setText(ev.target.value) }),
          el('div', { className: 'dk-msgrow' },
            el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: send, disabled: busy || !text.trim() }, '发送'),
            note ? el('span', { className: 'dk-note' }, note) : null,
          ),
        ) : null,
      )
    }

    function AgentsTab(props) {
      const st = props.st || { agents: [] }
      const rows = st.agents || []
      return el('div', null,
        el('div', { className: 'dk-h3' }, '智能体监督（' + rows.length + ' 个）· 每 2.5 秒自动刷新'),
        rows.length === 0 ? el('div', { className: 'dk-empty' }, '当前没有已注册的智能体。') : rows.map((a) => el(AgentRow, { key: a.id, agent: a })),
      )
    }

    function JobsTab(props) {
      const st = props.st || { jobs: [] }
      const jobs = st.jobs || []
      const kill = async (id) => {
        try {
          const res = await host.call('job-kill', { jobId: id })
          patch({ insertHint: res && res.ok ? '任务 ' + id + ' 已请求结束' : '失败: ' + (res && res.error ? res.error : '未知') })
        } catch (e) {}
      }
      return el('div', null,
        el('div', { className: 'dk-h3' }, '后台任务（' + jobs.length + ' 个）'),
        jobs.length === 0 ? el('div', { className: 'dk-empty' }, '当前没有后台任务。') : jobs.map((j) => el('div', { className: 'dk-agentrow', key: j.id },
          el('span', { className: 'dk-mono' }, j.id),
          StatusBadge(j.status),
          el('span', null, j.kind || ''),
          el('div', { className: 'dk-agentactions' }, el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => kill(j.id) }, '结束')),
        )),
      )
    }

    function MediaTab(props) {
      const st = props.st || { media: [] }
      const media = st.media || []
      const [pathText, setPathText] = React.useState('')
      React.useEffect(() => {
        for (const m of media) {
          if (!mediaCache.has(m.ref)) {
            host.call('media-read', { ref: m.ref }).then((res) => {
              if (res && res.ok && res.base64) { mediaCache.set(m.ref, 'data:' + m.mimeType + ';base64,' + res.base64); emit() }
            }).catch(() => {})
          }
        }
      }, [media])
      const onFileChange = (ev) => {
        const files = ev && ev.target && ev.target.files
        const file = files && files[0]
        if (!file) return
        try {
          if (typeof FileReader === 'undefined') { patch({ insertHint: '浏览器文件读取不可用，请使用“路径导入”' }); return }
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result || '')
            const comma = dataUrl.indexOf(',')
            const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
            host.call('media-save', { name: file.name, base64: b64 }).then(async (res) => {
              await refresh()
              patch({ insertHint: res && res.ok ? '已保存到图库 ✓' : '保存失败: ' + (res && res.error ? res.error : '未知') })
            }).catch(() => patch({ insertHint: '保存失败' }))
          }
          reader.onerror = () => patch({ insertHint: '读取文件失败' })
          reader.readAsDataURL(file)
        } catch (e) { patch({ insertHint: '浏览器文件读取不可用，请使用“路径导入”' }) }
      }
      const importPath = async () => {
        if (!pathText.trim()) return
        patch({ insertHint: '导入中…' })
        try {
          const res = await host.call('media-import', { path: pathText.trim() })
          if (res && res.ok) setPathText('')
          patch({ insertHint: res && res.ok ? '已导入到图库 ✓' : '导入失败: ' + (res && res.error ? res.error : '未知') })
          await refresh()
        } catch (e) { patch({ insertHint: '导入失败' }) }
      }
      const insert = (m) => { patch({ pendingInsert: refTextOf(m), insertHint: '' }) }
      const remove = async (ref) => { try { await host.call('media-delete', { ref: ref }); mediaCache.delete(ref); await refresh() } catch (e) {} }
      return el('div', null,
        el('div', { className: 'dk-h3' }, '媒体图库（' + media.length + '）· 多模态素材'),
        el('div', { className: 'dk-uploadrow' },
          el('input', { type: 'file', accept: 'image/*', className: 'dk-input dk-file', onChange: onFileChange }),
          el('input', { className: 'dk-input dk-pathinput', placeholder: '或输入本机图片路径，如 C:\\...\\img.png', value: pathText, onChange: (ev) => setPathText(ev.target.value) }),
          el('button', { className: 'dk-btn', onClick: importPath, disabled: !pathText.trim() }, '导入'),
        ),
        el('div', { className: 'dk-tip' }, '提示：点击卡片“插入消息”会把图片引用写入输入框，智能体会用 read_image 直接查看；图库也支持智能体用 devkit_media_save 工具交付图表。'),
        media.length === 0 ? el('div', { className: 'dk-empty' }, '图库为空。选择文件上传、输入本机路径导入，或让智能体保存图表到图库。') :
          el('div', { className: 'dk-grid' }, media.map((m) => el('div', { className: 'dk-media-card', key: m.ref },
            mediaCache.get(m.ref) ? el('img', { className: 'dk-thumb', src: mediaCache.get(m.ref), alt: m.name }) : el('div', { className: 'dk-thumb dk-thumb-empty' }, '加载中…'),
            el('div', { className: 'dk-media-name', title: m.name }, m.name),
            el('div', { className: 'dk-media-meta' }, m.sizeText || '', m.realPath ? ' · 已解码为真实文件' : ''),
            el('div', { className: 'dk-media-actions' },
              el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => insert(m) }, '插入消息'),
              el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => remove(m.ref) }, '删除'),
            ),
            m.realPath ? el('div', { className: 'dk-mono', title: m.realPath }, m.realPath) : null,
          ))),
      )
    }

    function WorkflowTab(props) {
      const st = props.st || { workflows: [], logs: [], errors: [] }
      const wfs = st.workflows || []
      const logs = st.logs || []
      const errors = st.errors || []
      return el('div', null,
        el('div', { className: 'dk-h3' }, '工作流（' + wfs.length + '）'),
        wfs.length === 0 ? el('div', { className: 'dk-empty' }, '暂无进行中的工作流。') : wfs.map((w) => el('div', { className: 'dk-agentrow', key: w.id || w.name },
          StatusBadge(w.status),
          el('span', null, w.name || w.id),
          w.phase ? el('span', { className: 'dk-note' }, '阶段: ' + w.phase) : null,
          w.timeText ? el('span', { className: 'dk-note' }, w.timeText) : null,
        )),
        el('div', { className: 'dk-h3' }, '最近日志'),
        logs.length === 0 ? el('div', { className: 'dk-empty' }, '无日志。') : logs.map((l, i) => el('div', { className: 'dk-log', key: 'l' + i }, (l.timeText || '') + '  ' + l.message)),
        el('div', { className: 'dk-h3' }, '最近错误'),
        errors.length === 0 ? el('div', { className: 'dk-empty' }, '无错误记录。') : errors.map((er, i) => el('div', { className: 'dk-log dk-log-err', key: 'e' + i }, (er.timeText || '') + '  [' + er.id + ']  ' + er.message)),
      )
    }

    function GoalTab(props) {
      const g = props.st ? props.st.goal : null
      if (!g) return el('div', null, el('div', { className: 'dk-h3' }, '当前目标'), el('div', { className: 'dk-empty' }, '当前会话没有进行中的目标。'))
      return el('div', null,
        el('div', { className: 'dk-h3' }, '当前目标'),
        el('div', { className: 'dk-goal' },
          el('div', { className: 'dk-goal-obj' }, g.objective || '（无描述）'),
          el('div', { className: 'dk-goal-meta' },
            '阶段: ' + (g.phase || '未知'),
            (g.rounds !== null && g.rounds !== undefined) ? ' · 已完成轮次: ' + g.rounds : '',
            g.maxRounds ? ' / ' + g.maxRounds : '',
          ),
          g.blockedReason ? el('div', { className: 'dk-goal-block' }, '阻塞原因: ' + g.blockedReason) : null,
        ),
      )
    }

    function ConsolePanel() {
      const s = useStore()
      const st = s.state || { agents: [], jobs: [], media: [], workflows: [], logs: [], errors: [], goal: null }
      const tabs = [['agents', '智能体'], ['jobs', '任务'], ['media', '图库'], ['workflows', '工作流'], ['goal', '目标']]
      const style = s.pos ? { left: s.pos.x + 'px', top: s.pos.y + 'px', right: 'auto' } : { right: 28, top: 84, left: 'auto' }
      const onHeadDown = (ev) => {
        try {
          const rect = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null
          if (rect) patch({ dragging: { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top } })
        } catch (e) {}
      }
      const onMove = (ev) => { if (store.dragging) patch({ pos: { x: ev.clientX - store.dragging.dx - 12, y: ev.clientY - store.dragging.dy - 6 } }) }
      const onUp = () => { if (store.dragging) patch({ dragging: null }) }
      const decoded = (st.media || []).filter((m) => m.realPath).length
      return el('div', { className: 'dk-console', style: style, onMouseMove: onMove, onMouseUp: onUp },
        el('div', { className: 'dk-head', onMouseDown: onHeadDown },
          el('span', { className: 'dk-title' }, '🧭 开发控制台'),
          tabs.map((t) => el('button', { key: t[0], className: 'dk-tab' + (s.tab === t[0] ? ' dk-tab-active' : ''), onClick: () => patch({ tab: t[0] }) }, t[1])),
          el('div', { className: 'dk-spacer' }),
          el('button', { className: 'dk-close', onClick: () => patch({ open: false }), title: '关闭' }, '✕'),
        ),
        el('div', { className: 'dk-body' },
          s.tab === 'agents' ? el(AgentsTab, { st: st }) : s.tab === 'jobs' ? el(JobsTab, { st: st }) : s.tab === 'media' ? el(MediaTab, { st: st }) : s.tab === 'workflows' ? el(WorkflowTab, { st: st }) : el(GoalTab, { st: st }),
        ),
        el('div', { className: 'dk-foot' },
          s.insertHint ? el('span', { className: 'dk-note' }, s.insertHint + '  ·  ') : null,
          s.lastError ? '⚠ ' + s.lastError : (s.connected ? '已连接 · 每 2.5s 自动刷新 · 图库 ' + ((st.media || []).length) + ' 项（' + decoded + ' 已解码）' : '连接中…'),
        ),
      )
    }

    function ConsoleRoot() {
      const s = useStore()
      React.useEffect(() => {
        refresh()
        return ctx.interval(refresh, 2500)
      }, [])
      if (!s.open) return null
      return el(ConsolePanel, null)
    }

    function DockStrip(props) {
      const s = useStore()
      const st = s.state || { agents: [], jobs: [], media: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const total = (st.agents || []).length
      React.useEffect(() => {
        if (s.pendingInsert && props && props.inputActions) {
          const ok = tryInsertText(props.inputActions, s.pendingInsert)
          patch({ pendingInsert: null, insertHint: ok ? '图片引用已插入输入框 ✓' : '未能自动插入，请到控制台复制文本' })
          if (ok) ctx.timeout(() => patch({ insertHint: '' }), 6000)
        }
      }, [s.pendingInsert])
      return el('div', { className: 'dk-dock' },
        el('span', { className: 'dk-dockstats' }, '🧭 智能体 ' + total + ' · 运行 ' + running + ' · 任务 ' + (st.jobs ? st.jobs.length : 0) + ' · 图库 ' + (st.media ? st.media.length : 0)),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ open: true, tab: 'agents' }) }, '控制台'),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ open: true, tab: 'media' }) }, '图库'),
        s.insertHint ? el('span', { className: 'dk-note' }, s.insertHint) : null,
      )
    }

    function FooterButton(props) {
      const s = useStore()
      const st = s.state || { agents: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const wide = !!(props && props.wide)
      return el('button', { className: 'dk-footbtn', title: '开发控制台（多模态/智能体监督）', onClick: () => patch({ open: !s.open }) },
        el('span', { className: 'dk-footicon' }, '🧭'),
        wide ? el('span', { className: 'dk-footlabel' }, '控制台') : null,
        running > 0 ? el('span', { className: 'dk-badge' }, String(running)) : null,
      )
    }

    function SelfCard() {
      const s = useStore()
      return el('div', { className: 'dk-self' },
        el('div', { className: 'dk-self-title' }, '✅ 开发增强套件已激活'),
        el('div', { className: 'dk-self-line' }, '多模态图库 · 智能体监督 · 后台任务 · 工作流 · 目标总览'),
        el('div', { className: 'dk-self-row' },
          el('button', { className: 'dk-btn dk-btn-primary', onClick: () => patch({ open: true, tab: 'agents' }) }, '打开控制台'),
          el('button', { className: 'dk-btn', onClick: () => patch({ open: true, tab: 'media' }) }, '打开图库'),
        ),
        el('div', { className: 'dk-tip' }, '入口：侧边栏底部“🧭 控制台”按钮；输入框上方有实时状态条。'),
      )
    }

    slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'devkit-dock', order: 30, label: '开发套件' }, (props) => el(DockStrip, props)))
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'devkit-console', order: 10, label: '开发控制台' }, () => el(ConsoleRoot, null)))
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'devkit-console-toggle', order: 10, label: '控制台' }, (props) => el(FooterButton, props)))
    slots.inject('tool.view.cordis', () => slots.register({ name: 'tool.view.cordis', key: 'self' }, () => el(SelfCard, null)))

    styles.insert(".dk-console{position:fixed;z-index:2147483000;width:min(680px,calc(100vw - 40px));height:min(540px,calc(100vh - 110px));display:flex;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.38);background:#ffffff;color:#1b1d22;font:13px/1.5 -apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;pointer-events:auto;border:1px solid rgba(110,120,140,.28)}.dk-head{display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(79,140,255,.08);border-bottom:1px solid rgba(110,120,140,.2);cursor:move;user-select:none;flex-wrap:wrap}.dk-title{font-weight:700;margin-right:4px}.dk-tab{border:none;background:transparent;color:inherit;padding:6px 10px;cursor:pointer;font:inherit;border-radius:6px}.dk-tab:hover{background:rgba(110,120,140,.12)}.dk-tab-active{background:rgba(79,140,255,.18);color:#4f8cff;font-weight:600}.dk-spacer{flex:1}.dk-close{border:none;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:6px}.dk-close:hover{background:rgba(239,68,68,.15)}.dk-body{flex:1;overflow:auto;padding:10px 12px}.dk-foot{padding:6px 12px;font-size:11px;color:#8a8f98;border-top:1px solid rgba(110,120,140,.2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dk-h3{font-size:12px;font-weight:700;margin:10px 0 6px}.dk-empty{color:#9aa0aa;padding:14px 4px;font-size:12px}.dk-agentrow{display:flex;align-items:center;gap:8px;padding:7px 4px;border-top:1px solid rgba(110,120,140,.15);flex-wrap:wrap}.dk-agentname{flex:1;min-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dk-agentactions{display:flex;gap:6px;align-items:center}.dk-status{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;min-width:96px}.dk-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}.dk-dot-running{background:#22c55e}.dk-dot-idle{background:#3b82f6}.dk-dot-ready{background:#9ca3af}.dk-dot-ended{background:#6b7280;opacity:.5}.dk-dot-unknown{background:#f59e0b}.dk-btn{background:rgba(110,120,140,.14);border:1px solid rgba(110,120,140,.3);color:inherit;border-radius:7px;padding:5px 12px;cursor:pointer;font:inherit}.dk-btn:hover{background:rgba(110,120,140,.24)}.dk-btn:disabled{opacity:.45;cursor:default}.dk-btn-primary{background:#4f8cff;border-color:#4f8cff;color:#fff}.dk-btn-primary:hover{background:#3d7bf0}.dk-btn-sm{background:rgba(110,120,140,.12);border:1px solid rgba(110,120,140,.25);color:inherit;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px}.dk-btn-sm:hover{background:rgba(110,120,140,.22)}.dk-btn-danger{color:#ef4444;border-color:rgba(239,68,68,.4)}.dk-btn-danger:hover{background:rgba(239,68,68,.12)}.dk-input{background:rgba(110,120,140,.07);border:1px solid rgba(110,120,140,.3);border-radius:6px;padding:5px 8px;color:inherit;font:inherit;width:100%;box-sizing:border-box}.dk-textarea{resize:vertical;min-height:44px}.dk-msgform{flex-basis:100%;display:flex;flex-direction:column;gap:6px;padding:4px 0 2px}.dk-msgrow{display:flex;gap:8px;align-items:center}.dk-note{color:#f59e0b;font-size:11px}.dk-uploadrow{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}.dk-file{width:auto;flex:none}.dk-pathinput{flex:1;min-width:220px}.dk-tip{color:#9aa0aa;font-size:11px;margin:6px 0}.dk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.dk-media-card{border:1px solid rgba(110,120,140,.25);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:5px}.dk-thumb{width:100%;height:96px;object-fit:cover;border-radius:6px;background:rgba(110,120,140,.1)}.dk-thumb-empty{display:flex;align-items:center;justify-content:center;color:#9aa0aa;font-size:11px}.dk-media-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dk-media-meta{font-size:11px;color:#9aa0aa}.dk-media-actions{display:flex;gap:6px}.dk-log{font-size:11px;color:#7c8290;white-space:pre-wrap;word-break:break-all;margin:2px 0;border-left:2px solid rgba(110,120,140,.25);padding-left:6px}.dk-log-err{border-left-color:#ef4444;color:#b45309}.dk-mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:#7c8290}.dk-goal{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:10px;padding:10px 12px}.dk-goal-obj{font-weight:600;margin-bottom:4px}.dk-goal-meta{font-size:12px;color:#6b7280}.dk-goal-block{font-size:12px;color:#ef4444;margin-top:4px}.dk-dock{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:8px;background:rgba(110,120,140,.06);border:1px solid rgba(110,120,140,.15);flex-wrap:wrap;font-size:12px}.dk-dockstats{color:#6b7280}.dk-footbtn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:8px}.dk-footbtn:hover{background:rgba(110,120,140,.14)}.dk-footicon{font-size:14px}.dk-footlabel{font-size:12px}.dk-badge{background:#ef4444;color:#fff;border-radius:9px;padding:0 7px;font-size:11px;line-height:16px}.dk-self{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}.dk-self-title{font-weight:700}.dk-self-line{font-size:12px;color:#6b7280}.dk-self-row{display:flex;gap:8px;margin-top:2px}@media (prefers-color-scheme: dark){.dk-console{background:#1e2127;color:#e6e6e6;border-color:rgba(140,150,170,.3)}.dk-foot,.dk-empty,.dk-tip,.dk-media-meta,.dk-self-line,.dk-goal-meta,.dk-log,.dk-dockstats,.dk-status{color:#8b93a1}.dk-note{color:#fbbf24}}")
  },
}
