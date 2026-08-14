// DSH DevKit · Client half (browser) — v4.0 原生嵌入版
// 用法：把本文件内容作为 cordis_define 的 code.client（内容本身即函数体）。
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const el = React.createElement

    let initSkin = 'light'
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initSkin = window.localStorage.getItem('dsh-devkit-skin') || 'light'
      }
    } catch (e) {}
    const SKIN_LIST = ['light', 'night', 'ocean', 'forest', 'sunset', 'graphite']
    const SKIN_NAMES = { light: '亮色', night: '暗夜', ocean: '海洋', forest: '森林', sunset: '日落', graphite: '水墨' }
    const store = { openPanel: 'none', workbench: false, autoVisionRef: null, state: null, connected: false, lastError: '', insertHint: '', skin: initSkin }
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

    const tryInsertText = (inputActions, inputState, text) => {
      if (!inputActions || typeof inputActions.setDraft !== 'function') return false
      try {
        const cur = inputState && typeof inputState.draft === 'string' ? inputState.draft : ''
        const sep = cur && cur.charAt(cur.length - 1) !== '\n' ? '\n' : ''
        inputActions.setDraft(cur + sep + text)
        return true
      } catch (e) { return false }
    }

    const refTextOf = (entry) => {
      if (!entry) return ''
      if (entry.realPath) return '请查看图片: ' + entry.realPath
      return '请查看图库图片“' + entry.name + '”（引用 devkit:' + entry.ref + '，base64 保存在工作区 .dsh-media-' + entry.ref + '.txt，请先用 pwsh 解码为 .png 再 read_image 查看分析）'
    }

    const STATUS_META = {
      running: { label: '运行中', cls: 'dk-dot-running' },
      idle: { label: '空闲', cls: 'dk-dot-idle' },
      ready: { label: '就绪', cls: 'dk-dot-ready' },
      ended: { label: '已结束', cls: 'dk-dot-ended' },
      unknown: { label: '未知', cls: 'dk-dot-unknown' },
    }
    const StatusBadge = (status) => {
      const meta = STATUS_META[status] || STATUS_META.unknown
      return el('span', { className: 'dk-status' }, el('span', { className: 'dk-dot ' + meta.cls }), meta.label)
    }
    const sizeText = (b) => { const x = Number(b) || 0; if (x >= 1048576) return (x / 1048576).toFixed(2) + ' MB'; if (x >= 1024) return Math.round(x / 1024) + ' KB'; return x ? x + ' B' : '' }

    // ── 图库大弹层：挂在输入框 overlay 锚点上 ──
    function GalleryPanel(props) {
      const s = useStore()
      const st = s.state || { media: [] }
      const media = st.media || []
      const [pathText, setPathText] = React.useState('')
      const [visionRef, setVisionRef] = React.useState(null)
      const [showManager, setShowManager] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [lightbox, setLightbox] = React.useState(null)
      const visionEntry = media.find((m) => m.ref === visionRef)
      const saveFile = (file, autoVision) => {
        if (!file) return
        try {
          if (typeof FileReader === 'undefined') { setNote('浏览器文件读取不可用，请使用路径导入'); return }
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result || '')
            const comma = dataUrl.indexOf(',')
            const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
            host.call('media-save', { name: file.name || '粘贴图片', base64: b64 }).then(async (res) => {
              await refresh()
              if (res && res.ok) {
                setNote(autoVision ? '已上传，自动打开识图 ✓' : '已保存到图库 ✓')
                if (autoVision && res.entry && res.entry.ref) setVisionRef(res.entry.ref)
              } else setNote('保存失败: ' + (res && res.error ? res.error : '未知'))
            }).catch(() => setNote('保存失败'))
          }
          reader.onerror = () => setNote('读取文件失败')
          reader.readAsDataURL(file)
        } catch (e) { setNote('浏览器文件读取不可用，请使用路径导入') }
      }
      // 粘贴图片的识图联动：Boot 全局粘贴上传后置 autoVisionRef，这里消费它自动打开识图面板
      React.useEffect(() => {
        if (s.autoVisionRef && media.find((m) => m.ref === s.autoVisionRef)) {
          setVisionRef(s.autoVisionRef)
          patch({ autoVisionRef: null })
        }
      }, [s.autoVisionRef, media])
      const onDrop = (ev) => {
        try {
          ev.preventDefault()
          const files = ev && ev.dataTransfer && ev.dataTransfer.files
          if (files && files[0]) saveFile(files[0], false)
        } catch (e) {}
      }
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
        saveFile(files && files[0], false)
      }
      const importPath = async () => {
        if (!pathText.trim()) return
        setNote('导入中…')
        try {
          const res = await host.call('media-import', { path: pathText.trim() })
          if (res && res.ok) setPathText('')
          setNote(res && res.ok ? '已导入到图库 ✓' : '导入失败: ' + (res && res.error ? res.error : '未知'))
          await refresh()
        } catch (e) { setNote('导入失败') }
      }
      const insert = (m) => {
        const text = refTextOf(m)
        if (props && props.inputActions) {
          const ok = tryInsertText(props.inputActions, props.input, text)
          setNote(ok ? '已写入输入框 ✓（可直接发送）' : '写入失败，请手动复制: ' + text)
        } else {
          setNote('当前没有输入框，请手动复制: ' + text)
        }
      }
      const remove = async (ref) => { try { await host.call('media-delete', { ref: ref }); mediaCache.delete(ref); await refresh() } catch (e) {} }
      return el('div', { className: 'dk-panel-backdrop', onMouseDown: () => props.onClose() },
        el('div', { className: 'dk-panel dk-gallery', onMouseDown: (ev) => ev.stopPropagation(), onDragOver: (ev) => { try { ev.preventDefault() } catch (e) {} }, onDrop: onDrop },
          el('div', { className: 'dk-panel-head' },
            el('span', { className: 'dk-panel-title' }, '🖼 多模态图库（' + media.length + '）'),
            el('button', { className: 'dk-btn-sm', onClick: () => setShowManager(!showManager), title: '管理视觉模型（识图 API）' }, '🛰 视觉模型'),
            el('div', { className: 'dk-spacer' }),
            el('button', { className: 'dk-close', onClick: props.onClose, title: '关闭' }, '✕'),
          ),
          showManager ? el(VisionManager, { compact: true, onClose: () => setShowManager(false) }) : null,
          el('div', { className: 'dk-uploadrow' },
            el('input', { type: 'file', accept: 'image/*', className: 'dk-input dk-file', onChange: onFileChange }),
            el('input', { className: 'dk-input dk-pathinput', placeholder: '或输入本机图片路径，如 C:\\...\\img.png', value: pathText, onChange: (ev) => setPathText(ev.target.value) }),
            el('button', { className: 'dk-btn', onClick: importPath, disabled: !pathText.trim() }, '导入'),
            note ? el('span', { className: 'dk-note' }, note) : null,
          ),
          el('div', { className: 'dk-tip' }, '支持拖拽图片到此处上传；页面任意处 Ctrl+V 粘贴图片（包括在聊天输入框内）将自动上传并打开识图；点击缩略图可放大预览。'),
          visionEntry ? el(VisionPanel, { entry: visionEntry, inputActions: props.inputActions, input: props.input, onClose: () => setVisionRef(null) }) : null,
          media.length === 0 ? el('div', { className: 'dk-empty' }, '图库为空。选择文件上传、输入本机路径导入，或让智能体保存图表到图库。') :
            el('div', { className: 'dk-grid' }, media.map((m) => el('div', { className: 'dk-media-card', key: m.ref },
              mediaCache.get(m.ref) ? el('img', { className: 'dk-thumb', src: mediaCache.get(m.ref), alt: m.name, title: '点击放大', onClick: () => setLightbox(mediaCache.get(m.ref)) }) : el('div', { className: 'dk-thumb dk-thumb-empty' }, '加载中…'),
              el('div', { className: 'dk-media-name', title: m.name }, m.name),
              el('div', { className: 'dk-media-meta' }, m.sizeText || '', m.realPath ? ' · 已解码' : ''),
              el('div', { className: 'dk-media-actions' },
                el('button', { className: 'dk-btn-sm', onClick: () => setVisionRef(m.ref) }, '识图'),
                el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => insert(m) }, '插入消息'),
                el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => remove(m.ref) }, '删除'),
              ),
            ))),
          lightbox ? el('div', { className: 'dk-lightbox', onMouseDown: () => setLightbox(null) },
            el('img', { className: 'dk-lightbox-img', src: lightbox, onMouseDown: (ev) => ev.stopPropagation() })) : null,
        ),
      )
    }

    // ── 监督内容（共享）：智能体树 + 任务看板 + 变更/文件 + 工作流/目标 ──
    function SupervisionTabs(props) {
      const s = useStore()
      const st = s.state || { agents: [], jobs: [], workflows: [], logs: [], errors: [], goal: null, usage: null }
      const [tab, setTab] = React.useState('agents')
      const agents = st.agents || []
      const kill = async (id) => {
        try {
          const res = await host.call('job-kill', { jobId: id })
          patch({ insertHint: res && res.ok ? '任务 ' + id + ' 已请求结束' : '失败: ' + (res && res.error ? res.error : '未知') })
        } catch (e) {}
      }
      const group = { running: [], idle: [], done: [] }
      for (const j of (st.jobs || [])) {
        const k = j.status === 'running' ? 'running' : (j.status === 'idle' || j.status === 'pending' || j.status === 'queued') ? 'idle' : 'done'
        group[k].push(j)
      }
      const u = st.usage
      const totalsLine = u && u.totals ? '模型用量（本会话进程累计）：' + u.totals.calls + ' 次调用 · 输入约 ' + u.totals.input + ' tok · 输出约 ' + u.totals.output + ' tok（启发式估测）' : ''
      return el('div', { className: 'dk-supervision' },
        el('div', { className: 'dk-super-tabs' },
          el('button', { className: 'dk-tab' + (tab === 'agents' ? ' dk-tab-active' : ''), onClick: () => setTab('agents') }, '智能体 ' + agents.length),
          el('button', { className: 'dk-tab' + (tab === 'jobs' ? ' dk-tab-active' : ''), onClick: () => setTab('jobs') }, '任务 ' + (st.jobs || []).length),
          el('button', { className: 'dk-tab' + (tab === 'scm' ? ' dk-tab-active' : ''), onClick: () => setTab('scm') }, '变更'),
          el('button', { className: 'dk-tab' + (tab === 'files' ? ' dk-tab-active' : ''), onClick: () => setTab('files') }, '文件'),
          el('button', { className: 'dk-tab' + (tab === 'wf' ? ' dk-tab-active' : ''), onClick: () => setTab('wf') }, '工作流 ' + (st.workflows || []).length),
          el('button', { className: 'dk-tab' + (tab === 'goal' ? ' dk-tab-active' : ''), onClick: () => setTab('goal') }, '目标'),
          el('div', { className: 'dk-spacer' }),
          el('button', { className: 'dk-btn-sm', onClick: refresh, title: '立即刷新' }, '刷新'),
        ),
        el('div', { className: 'dk-panel-body' },
          tab === 'agents' ? el('div', null,
            totalsLine ? el('div', { className: 'dk-tip' }, totalsLine) : null,
            agents.length === 0 ? el('div', { className: 'dk-empty' }, '当前没有已注册的智能体。') : agents.map((a) => el(AgentRow, { key: a.id, agent: a, st: st })),
          ) : tab === 'jobs' ? el('div', null,
            el('div', { className: 'dk-h3' }, '后台任务看板（按状态分列）'),
            (st.jobs || []).length === 0 ? el('div', { className: 'dk-empty' }, '当前没有后台任务。') : el('div', { className: 'dk-kanban' },
              el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '🟢 进行中 ' + group.running.length), group.running.map((j) => el(JobCard, { key: j.id, j: j, onKill: kill }))),
              el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '🔵 等待 ' + group.idle.length), group.idle.map((j) => el(JobCard, { key: j.id, j: j, onKill: kill }))),
              el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '⚪ 已结束 ' + group.done.length), group.done.map((j) => el(JobCard, { key: j.id, j: j, onKill: kill }))),
            ),
          ) : tab === 'scm' ? el(ScmTab, null) : tab === 'files' ? el(FilesTab, null) : tab === 'wf' ? el('div', null,
            el('div', { className: 'dk-h3' }, '工作流（' + (st.workflows || []).length + '）'),
            (st.workflows || []).length === 0 ? el('div', { className: 'dk-empty' }, '暂无进行中的工作流。') : (st.workflows || []).map((w) => el('div', { className: 'dk-agentrow', key: w.id || w.name },
              StatusBadge(w.status), el('span', null, w.name || w.id),
              w.phase ? el('span', { className: 'dk-note' }, '阶段: ' + w.phase) : null,
            )),
            el('div', { className: 'dk-h3' }, '最近日志'),
            (st.logs || []).length === 0 ? el('div', { className: 'dk-empty' }, '无日志。') : (st.logs || []).map((l, i) => el('div', { className: 'dk-log', key: 'l' + i }, (l.timeText || '') + '  ' + l.message)),
            el('div', { className: 'dk-h3' }, '最近错误'),
            (st.errors || []).length === 0 ? el('div', { className: 'dk-empty' }, '无错误记录。') : (st.errors || []).map((er, i) => el('div', { className: 'dk-log dk-log-err', key: 'e' + i }, (er.timeText || '') + '  [' + er.id + ']  ' + er.message)),
          ) : el(GoalTab, { st: st }),
        ),
      )
    }

    // ── 监督底部弹层（会话标题栏 🧭 按钮）──
    function AgentsPanel(props) {
      return el('div', { className: 'dk-panel-backdrop', onMouseDown: () => props.onClose() },
        el('div', { className: 'dk-panel dk-agents', onMouseDown: (ev) => ev.stopPropagation() },
          el('div', { className: 'dk-panel-head' },
            el('span', { className: 'dk-panel-title' }, '🧭 智能体监督'),
            el('div', { className: 'dk-spacer' }),
            el('button', { className: 'dk-close', onClick: props.onClose, title: '关闭' }, '✕'),
          ),
          el(SupervisionTabs, null),
        ),
      )
    }

    // ── 侧边栏工作台（左侧停靠常驻面板，侧边栏底部 🧰 按钮开关）──
    function WorkbenchPanel() {
      const s = useStore()
      if (!s.workbench) return null
      return el('div', { className: 'dk-workbench' },
        el('div', { className: 'dk-panel-head' },
          el('span', { className: 'dk-panel-title' }, '🧰 开发工作台'),
          el('div', { className: 'dk-spacer' }),
          el('button', { className: 'dk-close', onClick: () => patch({ workbench: false }), title: '关闭' }, '✕'),
        ),
        el(SupervisionTabs, null),
      )
    }

    function WorkbenchButton(props) {
      const s = useStore()
      const st = s.state || { agents: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const wide = !!(props && props.wide)
      return el('button', {
        className: 'dk-footbtn' + (s.workbench ? ' dk-footbtn-on' : ''),
        title: '开发工作台（智能体/任务/变更/文件/工作流/目标）',
        onClick: () => patch({ workbench: !s.workbench }),
      },
        el('span', { className: 'dk-footicon' }, '🧰'),
        wide ? el('span', { className: 'dk-footlabel' }, '工作台') : null,
        running > 0 ? el('span', { className: 'dk-badge' }, String(running)) : null,
      )
    }

    function JobCard(props) {
      const j = props.j
      return el('div', { className: 'dk-kcard' },
        el('div', { className: 'dk-kid dk-mono' }, j.id),
        el('div', { className: 'dk-kkind' }, j.label || j.kind || '任务'),
        el('div', { className: 'dk-agentactions' },
          StatusBadge(j.status),
          (j.status === 'running' || j.status === 'idle') ? el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => props.onKill(j.id) }, '结束') : null,
        ),
      )
    }

    // ── Git 变更（SCM）页签 ──
    function ScmTab(props) {
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [repo, setRepo] = React.useState('')
      const [commitMsg, setCommitMsg] = React.useState('')
      const load = async (wantRepo) => {
        setBusy(true)
        try {
          const res = await host.call('git-status', { repo: wantRepo || repo })
          if (res && res.ok) {
            setData(res)
            if (!wantRepo && res.repo) setRepo(res.repo.path)
            setNote('')
          } else setNote(res && res.error ? res.error : '读取失败')
        } catch (e) { setNote('读取失败') }
        setBusy(false)
      }
      React.useEffect(() => { load('') }, [])
      const act = async (op, path, message) => {
        try {
          const res = await host.call('git-op', { op: op, path: path, repo: repo, message: message || '' })
          setNote(op + (res && res.ok ? ' ✓' : ' 失败: ' + (res && res.error ? res.error : '未知')))
          if (res && res.ok && op === 'commit') setCommitMsg('')
          await load()
        } catch (e) { setNote('操作失败') }
      }
      const entries = data && data.entries ? data.entries : []
      const staged = entries.filter((e) => e.staged)
      const unstaged = entries.filter((e) => !e.staged && !e.untracked)
      const untracked = entries.filter((e) => e.untracked)
      const row = (e, group) => el('div', { className: 'dk-scmrow', key: group + e.path },
        el('span', { className: 'dk-scmflag dk-mono', title: '状态 ' + e.x + e.y }, e.x + e.y),
        el('span', { className: 'dk-scmname', title: e.path }, e.path),
        el('div', { className: 'dk-agentactions' },
          group === 'staged' ? el('button', { className: 'dk-btn-sm', onClick: () => act('unstage', e.path) }, '取消暂存') : null,
          group === 'unstaged' ? el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => act('stage', e.path) }, '暂存') : null,
          group === 'unstaged' ? el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => act('discard', e.path) }, '丢弃') : null,
          group === 'untracked' ? el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => act('stage', e.path) }, '暂存') : null,
        ),
      )
      const repos = data && Array.isArray(data.repos) ? data.repos : []
      return el('div', null,
        el('div', { className: 'dk-h3' }, 'Git 变更 · 分支: ' + (data && data.branch ? data.branch : '…')),
        el('div', { className: 'dk-uploadrow' },
          repos.length > 1 ? el('select', { className: 'dk-select dk-reposelect', value: repo, title: '切换仓库', onChange: (ev) => { setRepo(ev.target.value); load(ev.target.value) } },
            repos.map((r) => el('option', { key: r.path, value: r.path }, r.rel || '（根目录）'))) : null,
          el('button', { className: 'dk-btn', onClick: () => load(), disabled: busy }, busy ? '读取中…' : '刷新'),
          el('button', { className: 'dk-btn dk-btn-primary', onClick: () => act('stage-all', ''), disabled: entries.length === 0 || !data }, '全部暂存'),
          note ? el('span', { className: 'dk-note' }, note) : null,
        ),
        data && data.repo ? el('div', { className: 'dk-tip' }, '仓库: ' + data.repo.path) : null,
        data && data.note ? el('div', { className: 'dk-note' }, data.note) : null,
        data ? el('div', { className: 'dk-uploadrow' },
          el('input', { className: 'dk-input dk-commit-in', placeholder: '提交信息（Enter 提交）', value: commitMsg, onChange: (ev) => setCommitMsg(ev.target.value), onKeyDown: (ev) => { if (ev.key === 'Enter' && commitMsg.trim()) act('commit', '', commitMsg) } }),
          el('button', { className: 'dk-btn dk-btn-primary', onClick: () => act('commit', '', commitMsg), disabled: !commitMsg.trim() || staged.length === 0 }, '提交已暂存'),
        ) : null,
        !data && note ? el('div', { className: 'dk-empty' }, note) : null,
        data && entries.length === 0 ? el('div', { className: 'dk-empty' }, '工作区干净，没有变更。') : null,
        entries.length > 0 ? el('div', null,
          el('div', { className: 'dk-h3' }, '已暂存（' + staged.length + '）'),
          staged.map((e) => row(e, 'staged')),
          el('div', { className: 'dk-h3' }, '未暂存（' + unstaged.length + '）'),
          unstaged.map((e) => row(e, 'unstaged')),
          el('div', { className: 'dk-h3' }, '未跟踪（' + untracked.length + '）'),
          untracked.map((e) => row(e, 'untracked')),
        ) : null,
      )
    }

    // ── 文件浏览与预览页签 ──
    function FilesTab(props) {
      const [path, setPath] = React.useState('')
      const [items, setItems] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [note, setNote] = React.useState('')
      const load = async (p) => {
        try {
          const res = await host.call('fs-list', { path: p })
          if (res && res.ok) { setItems(res); setPath(res.rel || ''); setPreview(null); setNote('') }
          else setNote('读取失败: ' + (res && res.error ? res.error : '未知'))
        } catch (e) { setNote('读取失败') }
      }
      React.useEffect(() => { load('') }, [])
      const open = (e) => {
        if (e.isDir) load(path ? path + '/' + e.name : e.name)
        else show(e.name)
      }
      const show = async (name) => {
        const rel = path ? path + '/' + name : name
        setNote('加载预览…')
        try {
          const res = await host.call('fs-read', { path: rel })
          if (res && res.ok) { setPreview({ name: name, kind: res.kind, text: res.text || '', dataUrl: res.dataUrl || '', size: res.size || 0 }); setNote('') }
          else setNote('预览失败: ' + (res && res.error ? res.error : '未知'))
        } catch (e) { setNote('预览失败') }
      }
      const up = () => {
        if (!path) return
        const idx = path.lastIndexOf('/')
        load(idx > 0 ? path.slice(0, idx) : '')
      }
      const list = items ? items.entries || [] : []
      return el('div', null,
        el('div', { className: 'dk-h3' }, '工作区文件浏览 · 预览'),
        el('div', { className: 'dk-uploadrow' },
          el('button', { className: 'dk-btn-sm', onClick: up, disabled: !path }, '⬆ 上级'),
          el('span', { className: 'dk-mono dk-filepath', title: items ? items.abs : '' }, (path ? path : '（根目录）')),
          note ? el('span', { className: 'dk-note' }, note) : null,
        ),
        el('div', { className: 'dk-filetable' },
          list.length === 0 ? el('div', { className: 'dk-empty' }, '目录为空。') :
            list.map((e) => el('div', { className: 'dk-filerow', key: e.name, onClick: () => open(e) },
              el('span', { className: 'dk-ficon' }, e.isDir ? '📁' : '📄'),
              el('span', { className: 'dk-fname', title: e.name }, e.name),
              e.isDir ? null : el('span', { className: 'dk-fsize' }, sizeText(e.size)),
            )),
        ),
        preview ? el('div', { className: 'dk-preview' },
          el('div', { className: 'dk-preview-head' }, '预览: ' + preview.name + ' (' + sizeText(preview.size) + ')',
            el('button', { className: 'dk-btn-sm dk-preview-close', onClick: () => setPreview(null) }, '关闭')),
          preview.kind === 'image' ? el('img', { className: 'dk-preview-img', src: preview.dataUrl, alt: preview.name }) :
            el('pre', { className: 'dk-preview-text' }, preview.text),
        ) : null,
        el('div', { className: 'dk-tip' }, '提示：点击文件夹进入，点击文件预览；图片 ≤4MB、文本 ≤256KB 可直接预览。'),
      )
    }

    function AgentRow(props) {
      const agent = props.agent
      const st = props.st || {}
      const [openMsg, setOpenMsg] = React.useState(false)
      const [text, setText] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const canInterrupt = agent.status === 'running' && !agent.isRoot
      // one-shot（一次性任务）不能发新消息，只能查看
      const isOneShot = agent.mode === 'one-shot'
      const canMessage = !agent.isRoot && !isOneShot
      const label = agent.isRoot ? '★ 主会话' : (agent.label || '未命名')
      // listDescendants 自带真实 depth（直接子级=1）
      const depth = Math.max(0, Number(agent.depth) || 0)
      // 运行时长（基于状态快照时间）
      let ageText = ''
      if (agent.createdAt && st.updatedAt) {
        const sec = Math.max(0, Math.round((st.updatedAt - agent.createdAt) / 1000))
        if (sec >= 3600) ageText = Math.floor(sec / 3600) + 'h' + Math.floor((sec % 3600) / 60) + 'm'
        else if (sec >= 60) ageText = Math.floor(sec / 60) + 'm' + (sec % 60) + 's'
        else ageText = sec + 's'
      }
      const openSession = async () => {
        try {
          const sessions = ctx.get('sessions')
          if (!sessions) { patch({ insertHint: '当前页面不支持跳转子会话' }); return }
          const mode = agent.mode === 'one-shot' ? 'one-shot' : 'continuable'
          // 真实直接父级：优先用状态里的 parentId，缺失时向宿主反查（agent-parent）
          let parentId = st.rootSessionId || (agent.parentId || '')
          let debugInfo = ''
          if (!agent.parentId) {
            try {
              const res = await host.call('agent-parent', { agentId: agent.id })
              if (res && res.ok && res.parentId) parentId = res.parentId
              if (res && res.ok && Array.isArray(res.debug) && res.debug.length > 0) {
                debugInfo = ' [诊断: ' + res.debug.map((d) => d.pid.slice(0, 10) + (d.err ? '!' + d.err.slice(0, 60) : '~' + d.count)).join('; ') + ']'
              }
            } catch (e) { debugInfo = ' [诊断: 反查异常]' }
          }
          const attempts = [
            function () { sessions.openSubagent({ parentSessionId: parentId, childSessionId: agent.id, mode: mode }) },
            function () { sessions.open(agent.id) },
            function () { sessions.openSubagent({ parentSessionId: parentId, childSessionId: agent.id, mode: mode === 'one-shot' ? 'continuable' : 'one-shot' }) },
          ]
          for (const fn of attempts) {
            try { fn(); return } catch (e) {}
          }
          patch({ insertHint: '打开会话失败（父级: ' + parentId + '）' + debugInfo })
        } catch (e) { patch({ insertHint: '打开会话失败' }) }
      }
      const goalLine = agent.isRoot && st.goal && st.goal.objective ? '🎯 ' + st.goal.objective : ''
      const send = async () => {
        if (!text.trim()) return
        setBusy(true); setNote('发送中…')
        try {
          const res = await host.call('agent-message', { agentId: agent.id, text: text, parentId: agent.parentId || '' })
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
      return el('div', { className: 'dk-agentrow', style: depth > 0 ? { marginLeft: (depth * 14) + 'px' } : null },
        depth > 0 ? el('span', { className: 'dk-mono dk-depth', title: '深度 ' + depth }, '└'.repeat(1) + '─'.repeat(Math.min(depth, 6))) : null,
        StatusBadge(agent.status),
        el('div', { className: 'dk-agentname', title: agent.id }, label, el('span', { className: 'dk-mono' }, ' ' + String(agent.id || '').slice(0, 12))),
        ageText ? el('span', { className: 'dk-tip dk-age', title: '运行时长' }, ageText) : null,
        isOneShot ? el('span', { className: 'dk-tip', title: '一次性任务，完成后不能继续发消息' }, '一次性') : null,
        el('div', { className: 'dk-agentactions' },
          !agent.isRoot ? el('button', { className: 'dk-btn-sm', title: '跳转到该智能体的会话页面', onClick: openSession }, '打开') : null,
          canMessage ? el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => { setOpenMsg(!openMsg); setNote('') } }, openMsg ? '收起' : '发消息') : null,
          canInterrupt ? el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: stop }, '打断') : null,
        ),
        goalLine ? el('div', { className: 'dk-tip dk-goalline' }, goalLine) : null,
        openMsg ? el('div', { className: 'dk-msgform' },
          el('textarea', { className: 'dk-input dk-textarea', rows: 2, placeholder: '发送给该智能体的新消息…（作为它的下一轮）', value: text, onChange: (ev) => setText(ev.target.value) }),
          el('div', { className: 'dk-msgrow' },
            el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: send, disabled: busy || !text.trim() }, '发送'),
            note ? el('span', { className: 'dk-note' }, note) : null,
          ),
        ) : null,
      )
    }

    function GoalTab(props) {
      const g = props.st ? props.st.goal : null
      if (!g) return el('div', null, el('div', { className: 'dk-h3' }, '当前目标'), el('div', { className: 'dk-empty' }, '当前会话没有进行中的目标。'))
      return el('div', null,
        el('div', { className: 'dk-h3' }, '当前目标'),
        el('div', { className: 'dk-goal' },
          el('div', { className: 'dk-goal-obj' }, g.objective || '（无描述）'),
          el('div', { className: 'dk-goal-meta' }, '阶段: ' + (g.phase || '未知'), (g.rounds !== null && g.rounds !== undefined) ? ' · 已完成轮次: ' + g.rounds : '', g.maxRounds ? ' / ' + g.maxRounds : ''),
          g.blockedReason ? el('div', { className: 'dk-goal-block' }, '阻塞原因: ' + g.blockedReason) : null,
        ),
      )
    }

    // ── 识图面板（图库内嵌）──
    function VisionPanel(props) {
      const entry = props.entry
      const [routes, setRoutes] = React.useState([])
      const [provider, setProvider] = React.useState('')
      const [model, setModel] = React.useState('')
      const [prompt, setPrompt] = React.useState('请详细描述这张图片的内容。')
      const [result, setResult] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        let alive = true
        host.call('vision-routes', {}).then((res) => {
          if (!alive) return
          if (res && res.ok && Array.isArray(res.routes)) {
            setRoutes(res.routes)
            if (res.routes.length > 0) {
              setProvider(res.routes[0].provider)
              const ms = res.routes[0].models || []
              if (ms.length > 0) setModel(ms[0].id)
            } else {
              setError('未发现可用的视觉模型路由：请先在「设置 → 开发增强套件」添加服务商 API Key')
            }
          } else {
            setError('未发现可用的视觉模型路由：请先在「设置 → 开发增强套件」添加服务商 API Key')
          }
        }).catch(() => { if (alive) setError('获取视觉模型列表失败') })
        return () => { alive = false }
      }, [])
      const cur = (routes || []).find((r) => r.provider === provider)
      const run = async () => {
        setBusy(true); setError(''); setResult('')
        try {
          const res = await host.call('vision-describe', { ref: entry.ref, provider: provider, model: model, prompt: prompt })
          if (res && res.ok) setResult(res.text || '')
          else setError(res && res.error ? res.error : '识别失败')
        } catch (e) { setError('识别失败') }
        setBusy(false)
      }
      const insert = () => {
        if (!result) return
        if (props && props.inputActions) {
          const ok = tryInsertText(props.inputActions, props.input, result)
          setError(ok ? '已写入输入框 ✓' : '写入失败，请手动复制结果')
        }
      }
      return el('div', { className: 'dk-vision' },
        el('div', { className: 'dk-h3' }, '🔍 识图：' + (entry.name || '')),
        el('div', { className: 'dk-uploadrow' },
          el('select', { className: 'dk-select', value: provider, onChange: (ev) => { setProvider(ev.target.value); const r = (routes || []).find((x) => x.provider === ev.target.value); setModel(r && r.models && r.models[0] ? r.models[0].id : '') } },
            routes.map((r) => el('option', { key: r.provider, value: r.provider }, r.name))),
          el('select', { className: 'dk-select', value: model, onChange: (ev) => setModel(ev.target.value) },
            (cur ? (cur.models || []) : []).map((m) => el('option', { key: m.id, value: m.id }, m.name))),
          el('button', { className: 'dk-btn dk-btn-primary', onClick: run, disabled: busy || !provider || !model }, busy ? '识别中…' : '识别'),
          el('button', { className: 'dk-btn-sm', onClick: props.onClose }, '关闭'),
        ),
        el('input', { className: 'dk-input', value: prompt, placeholder: '识别提示词，如：这张图里有什么？提取图中文字。', onChange: (ev) => setPrompt(ev.target.value) }),
        error ? el('div', { className: 'dk-log dk-log-err' }, error) : null,
        result ? el('textarea', { className: 'dk-input dk-vision-result', readOnly: true, value: result }) : null,
        result ? el('div', { className: 'dk-msgrow' },
          el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: insert }, '插入消息'),
          el('span', { className: 'dk-tip' }, '把识别结果写入输入框发送给智能体'),
        ) : null,
      )
    }

    // ── 视觉模型管理（图库弹层内 + 设置页共用）──
    function VisionManager(props) {
      const [routes, setRoutes] = React.useState([])
      const [route, setRoute] = React.useState('')
      const [displayName, setDisplayName] = React.useState('')
      const [baseURL, setBaseURL] = React.useState('')
      const [modelId, setModelId] = React.useState('')
      const [modelName, setModelName] = React.useState('')
      const [apiKey, setApiKey] = React.useState('')
      const [cw, setCw] = React.useState('128000')
      const [mt, setMt] = React.useState('8192')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const load = () => { host.call('vision-routes', {}).then((res) => { if (res && res.ok) setRoutes(res.routes || []) }).catch(() => {}) }
      React.useEffect(() => { load() }, [])
      const add = async () => {
        setBusy(true); setNote('')
        try {
          const res = await host.call('vision-add', {
            route: route, displayName: displayName, baseURL: baseURL, modelId: modelId, modelName: modelName, apiKey: apiKey, contextWindow: Number(cw), maxTokens: Number(mt),
            opTemplate: { op: 'set', path: ['providers'], value: null },
            valueTemplate: { displayName: '', apiKeyEnv: '', api: 'openai-completions', baseURL: '', defaultInput: ['text', 'image'], models: [{ id: '', name: '', input: ['text', 'image'], contextWindow: 128000, maxTokens: 8192 }] },
          })
          if (res && res.ok) { setNote('已添加路由 ' + res.route + ' ✓'); setApiKey(''); setRoute(''); setDisplayName(''); setBaseURL(''); setModelId(''); setModelName(''); load() }
          else setNote('添加失败: ' + (res && res.error ? res.error : '未知'))
        } catch (e) { setNote('添加失败') }
        setBusy(false)
      }
      const remove = async (r) => {
        try {
          const res = await host.call('vision-remove', { route: r, opTemplate: { op: 'unset', path: ['providers'] } })
          setNote(res && res.ok ? '已删除 ' + r + ' ✓' : '删除失败: ' + (res && res.error ? res.error : '未知'))
          load()
        } catch (e) { setNote('删除失败') }
      }
      return el('div', { className: 'dk-vision' },
        el('div', { className: 'dk-h3' }, '🛰 管理视觉模型（兼容任意 OpenAI 格式服务商）'),
        el('div', { className: 'dk-tip' }, '示例：智谱 baseURL=https://open.bigmodel.cn/api/paas/v4 模型 glm-4.5v；Kimi baseURL=https://api.moonshot.cn/v1 模型 kimi-latest；硅基流动 baseURL=https://api.siliconflow.cn/v1 模型 Qwen/Qwen2.5-VL-7B-Instruct。'),
        el('div', { className: 'dk-manage-row' },
          el('input', { className: 'dk-input dk-manage-in', placeholder: '路由名(英文)', value: route, onChange: (ev) => setRoute(ev.target.value) }),
          el('input', { className: 'dk-input dk-manage-in', placeholder: '显示名', value: displayName, onChange: (ev) => setDisplayName(ev.target.value) }),
          el('input', { className: 'dk-input dk-manage-in', placeholder: 'baseURL', value: baseURL, onChange: (ev) => setBaseURL(ev.target.value) }),
        ),
        el('div', { className: 'dk-manage-row' },
          el('input', { className: 'dk-input dk-manage-in', placeholder: '模型 id', value: modelId, onChange: (ev) => setModelId(ev.target.value) }),
          el('input', { className: 'dk-input dk-manage-in', placeholder: '模型名(可空)', value: modelName, onChange: (ev) => setModelName(ev.target.value) }),
          el('input', { className: 'dk-input dk-manage-in', placeholder: '上下文窗口', value: cw, onChange: (ev) => setCw(ev.target.value) }),
          el('input', { className: 'dk-input dk-manage-in', placeholder: '最大输出', value: mt, onChange: (ev) => setMt(ev.target.value) }),
        ),
        el('div', { className: 'dk-manage-row' },
          el('input', { className: 'dk-input dk-manage-in', type: 'password', placeholder: 'API Key', value: apiKey, onChange: (ev) => setApiKey(ev.target.value) }),
          el('button', { className: 'dk-btn dk-btn-primary', onClick: add, disabled: busy || !route || !baseURL || !modelId || !apiKey }, busy ? '添加中…' : '添加'),
        ),
        note ? el('span', { className: 'dk-note' }, note) : null,
        el('div', { className: 'dk-h3' }, '已配置的视觉路由（' + routes.length + '）'),
        routes.length === 0 ? el('div', { className: 'dk-empty' }, '尚未配置。添加后即可在图库「识图」中选择。') : routes.map((r) => el('div', { className: 'dk-agentrow', key: r.provider },
          el('span', null, r.name || r.provider),
          el('span', { className: 'dk-mono' }, r.provider + ' · ' + ((r.models || []).map((m) => m.id).join(', '))),
          el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => remove(r.provider) }, '删除'),
        )),
      )
    }

    // ── 设置页：开发增强套件 ──
    function SettingsSection(props) {
      const s = useStore()
      const st = s.state || { media: [] }
      const setSkin = (v) => {
        patch({ skin: v })
        try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('dsh-devkit-skin', v) } catch (e) {}
      }
      return el('div', { className: 'dk-settings' },
        el('div', { className: 'dk-h3' }, '🎨 界面皮肤'),
        el('div', { className: 'dk-uploadrow' },
          el('select', { className: 'dk-select', value: s.skin || 'light', onChange: (ev) => setSkin(ev.target.value) },
            SKIN_LIST.map((k) => el('option', { key: k, value: k }, SKIN_NAMES[k]))),
          el('span', { className: 'dk-tip' }, '即点即换，作用于图库弹层与监督面板。'),
        ),
        el('div', { className: 'dk-h3' }, '🛰 视觉模型（图库识图）'),
        el(VisionManager, { compact: true }),
        el('div', { className: 'dk-h3' }, 'ℹ️ 关于'),
        el('div', { className: 'dk-tip' }, 'DSH 开发增强套件 v4.0：图库按钮（输入框工具行）· 监督按钮（会话标题栏）· 令牌统计（输入框下方）· 视觉模型管理（本页）。图库数据存于工作区 .dsh-media/ 目录。功能设计借鉴 dsh-web-ui（Apache-2.0），特此致谢。'),
      )
    }

    // ── 令牌统计行（composer 正下方，与官方统计条并排）──
    function UsageLine() {
      const s = useStore()
      const u = s.state ? s.state.usage : null
      const cur = u && u.current
      const last = u && u.last
      // 流式中：显示实时字符进度
      if (cur && cur.status === 'streaming') {
        return el('div', { className: 'dk-usage' },
          '⚡ 生成中 · 已输出 ' + cur.chars + ' 字符' + (cur.model ? ' · ' + cur.model : ''),
        )
      }
      if (!last) return el('div', { className: 'dk-usage' }, '⚡ 令牌统计待首次生成')
      const parts = ['⚡ 出 ' + last.outputTokens + ' tok · ' + (last.durationMs ? (last.durationMs / 1000).toFixed(1) + 's' : '') + ' · ' + last.tps + ' T/s']
      if (last.cacheReadTokens && last.cacheReadTokens > 0) {
        const hit = Math.round(last.cacheReadTokens / Math.max(1, last.inputTokens + last.cacheReadTokens) * 100)
        parts.push('缓存命中 ' + hit + '%')
      }
      if (last.contextPct !== null && last.contextPct !== undefined) parts.push('上下文 ' + last.contextPct + '%')
      const pct = (last.contextPct !== null && last.contextPct !== undefined) ? last.contextPct : 0
      const barCls = pct > 90 ? ' dk-ctxbar-red' : pct > 70 ? ' dk-ctxbar-amber' : ''
      return el('div', { className: 'dk-usage' },
        parts.join(' · '),
        pct > 0 ? el('span', { className: 'dk-ctxbar', title: '上下文占用（含缓存读取）' }, el('span', { className: 'dk-ctxbar-fill' + barCls, style: { width: Math.min(100, pct) + '%' } })) : null,
      )
    }

    // ── 精简状态条（输入框上方）──
    function DockStrip(props) {
      const s = useStore()
      const st = s.state || { agents: [], jobs: [], media: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const total = (st.agents || []).length
      React.useEffect(() => {
        if (s.insertHint) {
          const t = ctx.timeout(() => patch({ insertHint: '' }), 6000)
          return () => { try { t() } catch (e) {} }
        }
      }, [s.insertHint])
      return el('div', { className: 'dk-dock' },
        el('span', { className: 'dk-dockstats' }, '🧭 智能体 ' + total + ' · 运行 ' + running + ' · 任务 ' + (st.jobs ? st.jobs.length : 0) + ' · 图库 ' + (st.media ? st.media.length : 0)),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ openPanel: 'gallery' }) }, '🖼 图库'),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ openPanel: 'agents' }) }, '🧭 监督'),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ workbench: !s.workbench }) }, '🧰 工作台'),
        el('button', { className: 'dk-btn-sm', onClick: refresh, title: '立即刷新状态' }, '刷新'),
        el('span', { className: 'dk-ver', title: '开发增强套件版本（看不到新功能时请刷新页面）' }, 'v4.5'),
        s.insertHint ? el('span', { className: 'dk-note' }, s.insertHint) : null,
        s.lastError ? el('span', { className: 'dk-note' }, '⚠ ' + s.lastError) : null,
      )
    }

    // ── 输入框工具行左端：图库按钮 ──
    function GalleryButton() {
      const s = useStore()
      const st = s.state || { media: [] }
      const open = s.openPanel === 'gallery'
      return el('button', {
        className: 'dk-toolbtn' + (open ? ' dk-toolbtn-on' : ''),
        title: '多模态图库（上传/识图/插入消息）',
        onClick: () => patch({ openPanel: open ? 'none' : 'gallery' }),
      }, '🖼', el('span', { className: 'dk-toolbtn-count' }, String((st.media || []).length)))
    }

    // ── 会话标题栏：监督按钮 ──
    function AgentsButton() {
      const s = useStore()
      const st = s.state || { agents: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const open = s.openPanel === 'agents'
      return el('button', {
        className: 'dk-toolbtn' + (open ? ' dk-toolbtn-on' : ''),
        title: '智能体监督（发消息/打断/任务看板/工作流/目标）',
        onClick: () => patch({ openPanel: open ? 'none' : 'agents' }),
      }, '🧭', running > 0 ? el('span', { className: 'dk-badge' }, String(running)) : null)
    }

    function SelfCard() {
      const s = useStore()
      return el('div', { className: 'dk-self' },
        el('div', { className: 'dk-self-title' }, '✅ 开发增强套件 v4.5 已激活（令牌统计真实化 + 智能体体验增强）'),
        el('div', { className: 'dk-self-line' }, '🧰 工作台（侧边栏底部+状态条）· 🖼 图库（Ctrl+Shift+G）· 🧭 监督（Ctrl+Shift+S）· 全局粘贴识图 · Git 提交 · ⚡ 令牌统计+上下文占用 · 🛰 视觉模型管理在设置页'),
        el('div', { className: 'dk-tip' }, '打开「设置 → 开发增强套件」配置视觉模型与皮肤。'),
      )
    }

    // ── 弹层渲染（input.overlay 锚点）：图库 / 监督 ──
    function GalleryOverlay(props) {
      const s = useStore()
      if (s.openPanel !== 'gallery') return null
      return el(GalleryPanel, { inputActions: props.inputActions, input: props.input, onClose: () => patch({ openPanel: 'none' }) })
    }
    function AgentsOverlay() {
      const s = useStore()
      if (s.openPanel !== 'agents') return null
      return el(AgentsPanel, { onClose: () => patch({ openPanel: 'none' }) })
    }

    // ── 全局轮询 + 皮肤应用 + 快捷键 ──
    function Boot() {
      const s = useStore()
      React.useEffect(() => {
        refresh()
        return ctx.interval(refresh, 2500)
      }, [])
      React.useEffect(() => {
        try {
          const b = document.body
          for (const k of SKIN_LIST) b.classList.remove('dk-skin-' + k)
          b.classList.add('dk-skin-' + (s.skin || 'light'))
        } catch (e) {}
      }, [s.skin])
      React.useEffect(() => {
        const onKey = (ev) => {
          try {
            if (ev.key === 'Escape') { patch({ openPanel: 'none', workbench: false }); return }
            if (!(ev.ctrlKey && ev.shiftKey)) return
            const k = (ev.key || '').toLowerCase()
            if (k === 'g') { ev.preventDefault(); patch({ openPanel: store.openPanel === 'gallery' ? 'none' : 'gallery' }) }
            else if (k === 's') { ev.preventDefault(); patch({ openPanel: store.openPanel === 'agents' ? 'none' : 'agents' }) }
          } catch (e) {}
        }
        try { window.addEventListener('keydown', onKey) } catch (e) {}
        return () => { try { window.removeEventListener('keydown', onKey) } catch (e) {} }
      }, [])
      // 全局粘贴图片 → 自动上传 + 打开图库 + 自动识图（借鉴 modlens，页面任意处生效）
      // 注意：捕获阶段注册 + preventDefault，即使焦点在输入框/聊天编辑器内也能拦截到粘贴的图片
      React.useEffect(() => {
        const onPaste = (ev) => {
          try {
            const cd = ev && ev.clipboardData
            if (!cd) return
            let file = null
            const items = cd.items
            if (items) {
              for (const it of items) {
                if (it && it.kind === 'file') {
                  const f = it.getAsFile ? it.getAsFile() : null
                  if (f && f.type && f.type.indexOf('image/') === 0) { file = f; break }
                }
              }
            }
            if (!file && cd.files && cd.files.length > 0) {
              const f0 = cd.files[0]
              if (f0 && f0.type && f0.type.indexOf('image/') === 0) file = f0
            }
            if (!file) return
            // 捕获并独占该粘贴，避免输入框把它当文本插入
            try { ev.preventDefault(); ev.stopPropagation() } catch (e) {}
            if (typeof FileReader === 'undefined') { patch({ insertHint: '浏览器不支持读取粘贴图片，请改用图库按钮上传' }); return }
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = String(reader.result || '')
              const comma = dataUrl.indexOf(',')
              const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
              host.call('media-save', { name: file.name || '粘贴图片', base64: b64 }).then(async (res) => {
                await refresh()
                if (res && res.ok && res.entry && res.entry.ref) {
                  patch({ openPanel: 'gallery', autoVisionRef: res.entry.ref, insertHint: '已粘贴上传并打开识图 ✓' })
                } else {
                  patch({ insertHint: '粘贴上传失败: ' + (res && res.error ? res.error : '未知') })
                }
              }).catch(() => patch({ insertHint: '粘贴上传失败' }))
            }
            reader.onerror = () => patch({ insertHint: '粘贴图片读取失败' })
            reader.readAsDataURL(file)
          } catch (e) {}
        }
        try { window.addEventListener('paste', onPaste, true) } catch (e) {}
        return () => { try { window.removeEventListener('paste', onPaste, true) } catch (e) {} }
      }, [])
      return null
    }

    slots.inject('conversation.input.dock', () => slots.register({ name: 'conversation.input.dock', id: 'devkit-dock', order: 30, label: '开发套件' }, (props) => el(DockStrip, props)))
    slots.inject('conversation.composer.dock', () => slots.register({ name: 'conversation.composer.dock', id: 'devkit-usage', order: 30, label: '令牌统计' }, () => el(UsageLine, null)))
    slots.inject('conversation.input.left', () => slots.register({ name: 'conversation.input.left', id: 'devkit-gallery-btn', order: 30, label: '图库' }, () => el(GalleryButton, null)))
    slots.inject('conversation.input.overlay', () => slots.register({ name: 'conversation.input.overlay', id: 'devkit-gallery-panel', order: 30, label: '图库弹层' }, (props) => el(GalleryOverlay, props)))
    slots.inject('conversation.input.overlay', () => slots.register({ name: 'conversation.input.overlay', id: 'devkit-agents-panel', order: 31, label: '监督弹层' }, () => el(AgentsOverlay, null)))
    slots.inject('conversation.session.header.actions', () => slots.register({ name: 'conversation.session.header.actions', id: 'devkit-agents-btn', order: 30, label: '智能体监督' }, () => el(AgentsButton, null)))
    slots.inject('settings.section', () => slots.register({ name: 'settings.section', id: 'devkit', order: 30, label: '开发增强套件' }, (props) => el(SettingsSection, props)))
    slots.inject('sidebar.footer.action', () => slots.register({ name: 'sidebar.footer.action', id: 'devkit-workbench-btn', order: 10, label: '工作台' }, (props) => el(WorkbenchButton, props)))
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'devkit-workbench', order: 10, label: '开发工作台' }, () => el(WorkbenchPanel, null)))
    slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: 'devkit-boot', order: 10, label: '开发套件引导' }, () => el(Boot, null)))
    slots.inject('tool.view.cordis', () => slots.register({ name: 'tool.view.cordis', key: 'self' }, () => el(SelfCard, null)))

    styles.insert(".dk-panel-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(15,18,25,.35)}.dk-panel{position:fixed;left:50%;bottom:140px;transform:translateX(-50%);width:min(820px,94vw);max-height:64vh;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.4);background:#ffffff;color:#1b1d22;font:13px/1.5 -apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;border:1px solid rgba(110,120,140,.28)}")
    styles.insert(".dk-panel-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(79,140,255,.08);border-bottom:1px solid rgba(110,120,140,.2);flex-wrap:wrap}.dk-panel-title{font-weight:700;margin-right:4px}.dk-panel-body{flex:1;overflow:auto;padding:12px 14px}")
    styles.insert(".dk-tab{border:none;background:transparent;color:inherit;padding:6px 10px;cursor:pointer;font:inherit;border-radius:6px}.dk-tab:hover{background:rgba(110,120,140,.12)}.dk-tab-active{background:rgba(79,140,255,.18);color:#4f8cff;font-weight:600}.dk-spacer{flex:1}.dk-close{border:none;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:6px}.dk-close:hover{background:rgba(239,68,68,.15)}")
    styles.insert(".dk-h3{font-size:12px;font-weight:700;margin:10px 0 6px}.dk-empty{color:#9aa0aa;padding:14px 4px;font-size:12px}.dk-tip{color:#9aa0aa;font-size:11px;margin:6px 0}.dk-note{color:#f59e0b;font-size:11px}")
    styles.insert(".dk-agentrow{display:flex;align-items:center;gap:8px;padding:7px 4px;border-top:1px solid rgba(110,120,140,.15);flex-wrap:wrap}.dk-agentname{flex:1;min-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dk-agentactions{display:flex;gap:6px;align-items:center}.dk-status{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;min-width:88px}")
    styles.insert(".dk-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}.dk-dot-running{background:#22c55e}.dk-dot-idle{background:#3b82f6}.dk-dot-ready{background:#9ca3af}.dk-dot-ended{background:#6b7280;opacity:.5}.dk-dot-unknown{background:#f59e0b}")
    styles.insert(".dk-btn{background:rgba(110,120,140,.14);border:1px solid rgba(110,120,140,.3);color:inherit;border-radius:7px;padding:5px 12px;cursor:pointer;font:inherit}.dk-btn:hover{background:rgba(110,120,140,.24)}.dk-btn:disabled{opacity:.45;cursor:default}.dk-btn-primary{background:#4f8cff;border-color:#4f8cff;color:#fff}.dk-btn-primary:hover{background:#3d7bf0}")
    styles.insert(".dk-btn-sm{background:rgba(110,120,140,.12);border:1px solid rgba(110,120,140,.25);color:inherit;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px}.dk-btn-sm:hover{background:rgba(110,120,140,.22)}.dk-btn-danger{color:#ef4444;border-color:rgba(239,68,68,.4)}.dk-btn-danger:hover{background:rgba(239,68,68,.12)}")
    styles.insert(".dk-input{background:rgba(110,120,140,.07);border:1px solid rgba(110,120,140,.3);border-radius:6px;padding:5px 8px;color:inherit;font:inherit;width:100%;box-sizing:border-box}.dk-select{background:rgba(110,120,140,.08);border:1px solid rgba(110,120,140,.3);border-radius:6px;padding:5px 8px;color:inherit;font:inherit;max-width:220px}.dk-textarea{resize:vertical;min-height:44px}")
    styles.insert(".dk-msgform{flex-basis:100%;display:flex;flex-direction:column;gap:6px;padding:4px 0 2px}.dk-msgrow{display:flex;gap:8px;align-items:center}.dk-uploadrow{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}.dk-file{width:auto;flex:none}.dk-pathinput{flex:1;min-width:220px}")
    styles.insert(".dk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.dk-media-card{border:1px solid rgba(110,120,140,.25);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:5px}.dk-thumb{width:100%;height:96px;object-fit:cover;border-radius:6px;background:rgba(110,120,140,.1)}.dk-thumb-empty{display:flex;align-items:center;justify-content:center;color:#9aa0aa;font-size:11px}")
    styles.insert(".dk-media-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dk-media-meta{font-size:11px;color:#9aa0aa}.dk-media-actions{display:flex;gap:6px}.dk-mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:#7c8290}")
    styles.insert(".dk-log{font-size:11px;color:#7c8290;white-space:pre-wrap;word-break:break-all;margin:2px 0;border-left:2px solid rgba(110,120,140,.25);padding-left:6px}.dk-log-err{border-left-color:#ef4444;color:#b45309}")
    styles.insert(".dk-kanban{display:flex;gap:10px;align-items:flex-start}.dk-kcol{flex:1;min-width:0;background:rgba(110,120,140,.07);border:1px solid rgba(110,120,140,.18);border-radius:8px;padding:8px}.dk-khead{font-size:12px;font-weight:700;margin-bottom:6px}.dk-kcard{background:#ffffff;border:1px solid rgba(110,120,140,.2);border-radius:8px;padding:8px;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,.06)}.dk-kid{font-size:11px;color:#6b7280;word-break:break-all}.dk-kkind{font-size:12px;margin:2px 0 6px;font-weight:600}")
    styles.insert(".dk-goal{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:10px;padding:10px 12px}.dk-goal-obj{font-weight:600;margin-bottom:4px}.dk-goal-meta{font-size:12px;color:#6b7280}.dk-goal-block{font-size:12px;color:#ef4444;margin-top:4px}")
    styles.insert(".dk-vision{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:10px;padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:6px}.dk-vision-result{width:100%;min-height:96px;resize:vertical;font-size:12px}.dk-manage-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0}.dk-manage-in{flex:1;min-width:130px}")
    styles.insert(".dk-dock{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:8px;background:rgba(110,120,140,.06);border:1px solid rgba(110,120,140,.15);flex-wrap:wrap;font-size:12px}.dk-dockstats{color:#6b7280}.dk-ver{font-size:10px;color:#9aa0aa;font-family:ui-monospace,Consolas,monospace}")
    styles.insert(".dk-usage{font-size:11px;color:#4f8cff;padding:2px 4px;white-space:nowrap}.dk-ctxbar{display:inline-block;width:70px;height:6px;border-radius:3px;background:rgba(110,120,140,.25);margin-left:6px;vertical-align:middle;overflow:hidden}.dk-ctxbar-fill{display:block;height:100%;background:#22c55e}.dk-ctxbar-amber{background:#f59e0b}.dk-ctxbar-red{background:#ef4444}.dk-depth{flex:none;color:#9aa0aa}.dk-age{flex:none;min-width:44px}.dk-goalline{flex-basis:100%;margin:0}.dk-toolbtn{display:inline-flex;align-items:center;gap:4px;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:8px}.dk-toolbtn:hover{background:rgba(110,120,140,.14)}.dk-toolbtn-on{background:rgba(79,140,255,.18);color:#4f8cff}.dk-toolbtn-count{font-size:10px;color:#8a8f98}")
    styles.insert(".dk-badge{background:#ef4444;color:#fff;border-radius:9px;padding:0 7px;font-size:11px;line-height:16px}.dk-settings{display:flex;flex-direction:column;gap:4px;padding:4px 0}")
    styles.insert(".dk-self{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}.dk-self-title{font-weight:700}.dk-self-line{font-size:12px;color:#6b7280}")
    styles.insert("@media (prefers-color-scheme: dark){.dk-panel{background:#1e2127;color:#e6e6e6;border-color:rgba(140,150,170,.3)}.dk-kcard{background:#232730;border-color:rgba(140,150,170,.25)}.dk-empty,.dk-tip,.dk-media-meta,.dk-dockstats,.dk-log,.dk-status,.dk-toolbtn-count{color:#8b93a1}.dk-note{color:#fbbf24}}")
    styles.insert(".dk-skin-night .dk-panel{background:#171a23;color:#dbe2ef;border-color:rgba(140,160,200,.25)}.dk-skin-night .dk-panel-head{background:rgba(120,150,255,.1)}.dk-skin-night .dk-tab-active{background:rgba(99,130,255,.28);color:#9db4ff}.dk-skin-night .dk-agentrow{border-top-color:rgba(140,160,200,.16)}.dk-skin-night .dk-kcard{background:#1e2430;border-color:rgba(140,160,200,.25)}.dk-skin-night .dk-kcol{background:rgba(120,150,255,.05);border-color:rgba(140,160,200,.25)}.dk-skin-night .dk-input,.dk-skin-night .dk-select,.dk-skin-night .dk-textarea{background:#1e2430;color:#dbe2ef;border-color:rgba(140,160,200,.3)}.dk-skin-night .dk-empty,.dk-skin-night .dk-note{color:#8b95a8}.dk-skin-night .dk-dock{background:rgba(23,26,35,.92);color:#dbe2ef}")
    styles.insert(".dk-skin-ocean .dk-panel{background:#f5fbff;color:#0f2e3d;border-color:rgba(14,165,233,.3)}.dk-skin-ocean .dk-panel-head{background:rgba(14,165,233,.12)}.dk-skin-ocean .dk-tab-active{background:rgba(14,165,233,.22);color:#0369a1}.dk-skin-ocean .dk-btn-primary{background:#0ea5e9}")
    styles.insert(".dk-skin-forest .dk-panel{background:#f6fdf8;color:#12321f;border-color:rgba(22,163,74,.3)}.dk-skin-forest .dk-panel-head{background:rgba(22,163,74,.12)}.dk-skin-forest .dk-tab-active{background:rgba(22,163,74,.22);color:#15803d}.dk-skin-forest .dk-btn-primary{background:#16a34a}")
    styles.insert(".dk-skin-sunset .dk-panel{background:#fff8f3;color:#3d1d0b;border-color:rgba(249,115,22,.3)}.dk-skin-sunset .dk-panel-head{background:rgba(249,115,22,.12)}.dk-skin-sunset .dk-tab-active{background:rgba(249,115,22,.22);color:#c2410c}.dk-skin-sunset .dk-btn-primary{background:#f97316}")
    styles.insert(".dk-skin-graphite .dk-panel{background:#22262e;color:#e2e8f0;border-color:rgba(148,163,184,.3)}.dk-skin-graphite .dk-panel-head{background:rgba(148,163,184,.12)}.dk-skin-graphite .dk-tab-active{background:rgba(148,163,184,.25);color:#cbd5e1}.dk-skin-graphite .dk-kcard{background:#2a2f3a;border-color:rgba(148,163,184,.25)}.dk-skin-graphite .dk-input,.dk-skin-graphite .dk-select,.dk-skin-graphite .dk-textarea{background:#2a2f3a;color:#e2e8f0;border-color:rgba(148,163,184,.3)}.dk-skin-graphite .dk-dock{background:rgba(34,38,46,.92);color:#e2e8f0}")
    styles.insert(".dk-scmrow{display:flex;align-items:center;gap:8px;padding:5px 4px;border-top:1px solid rgba(110,120,140,.15)}.dk-scmflag{width:20px;font-size:11px;color:#b45309}.dk-scmname{flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.dk-reposelect{max-width:140px}")
    styles.insert(".dk-filepath{flex:1;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#6b7280}.dk-filetable{max-height:240px;overflow:auto;border:1px solid rgba(110,120,140,.2);border-radius:8px;margin-top:6px}.dk-filerow{display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer;border-top:1px solid rgba(110,120,140,.1)}")
    styles.insert(".dk-filerow:first-child{border-top:none}.dk-filerow:hover{background:rgba(79,140,255,.1)}.dk-ficon{flex:none}.dk-fname{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.dk-fsize{font-size:11px;color:#8a8f98}.dk-preview{margin-top:10px;border:1px solid rgba(110,120,140,.2);border-radius:8px;overflow:hidden}")
    styles.insert(".dk-preview-head{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;font-weight:600;background:rgba(79,140,255,.08);border-bottom:1px solid rgba(110,120,140,.18)}.dk-preview-close{margin-left:auto}.dk-preview-img{display:block;max-width:100%;max-height:280px;margin:0 auto}.dk-preview-text{margin:0;padding:10px;font:12px/1.6 Consolas,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:260px;overflow:auto;background:rgba(0,0,0,.03)}")
    styles.insert(".dk-lightbox{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;cursor:zoom-out}.dk-lightbox-img{max-width:92vw;max-height:88vh;border-radius:8px;box-shadow:0 12px 60px rgba(0,0,0,.6);cursor:default}.dk-commit-in{flex:1;min-width:200px}.dk-thumb{cursor:zoom-in}")
    styles.insert(".dk-workbench{position:fixed;left:288px;top:8px;bottom:8px;width:min(440px,40vw);z-index:2147482900;display:flex;flex-direction:column;border-radius:14px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.35);background:#ffffff;color:#1b1d22;font:13px/1.5 -apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;border:1px solid rgba(110,120,140,.28)}.dk-supervision{display:flex;flex-direction:column;flex:1;min-height:0}.dk-super-tabs{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid rgba(110,120,140,.2);flex-wrap:wrap}")
    styles.insert(".dk-footbtn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:8px}.dk-footbtn:hover{background:rgba(110,120,140,.14)}.dk-footbtn-on{background:rgba(79,140,255,.18);color:#4f8cff}.dk-footicon{font-size:14px}.dk-footlabel{font-size:12px}")
    styles.insert("@media (prefers-color-scheme: dark){.dk-workbench{background:#1e2127;color:#e6e6e6;border-color:rgba(140,150,170,.3)}}")
    styles.insert(".dk-skin-night .dk-workbench{background:#171a23;color:#dbe2ef;border-color:rgba(140,160,200,.25)}.dk-skin-ocean .dk-workbench{background:#f5fbff;color:#0f2e3d;border-color:rgba(14,165,233,.3)}.dk-skin-forest .dk-workbench{background:#f6fdf8;color:#12321f;border-color:rgba(22,163,74,.3)}.dk-skin-sunset .dk-workbench{background:#fff8f3;color:#3d1d0b;border-color:rgba(249,115,22,.3)}.dk-skin-graphite .dk-workbench{background:#22262e;color:#e2e8f0;border-color:rgba(148,163,184,.3)}")
  },
}
