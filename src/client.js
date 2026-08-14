// DSH DevKit · Client half (browser)
// 用法：把本文件内容作为 cordis_define 的 code.client（内容本身即函数体）。
return {
  inject: ['timer'],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return

    const el = React.createElement

    let initSkin = 'light'
    let initWidth = 680
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        initSkin = window.localStorage.getItem('dsh-devkit-skin') || 'light'
        const w = parseInt(window.localStorage.getItem('dsh-devkit-width') || '', 10)
        if (Number.isFinite(w) && w >= 380) initWidth = w
      }
    } catch (e) {}
    const SKIN_LIST = ['light', 'night', 'ocean', 'forest', 'sunset', 'graphite']
    const SKIN_NAMES = { light: '亮色', night: '暗夜', ocean: '海洋', forest: '森林', sunset: '日落', graphite: '水墨' }
    const store = { open: false, tab: 'agents', state: null, connected: false, lastError: '', pendingInsert: null, pendingInsertRef: null, insertHint: '', pos: null, dragging: null, skin: initSkin, width: initWidth, resizing: null }
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
      const canInterrupt = agent.status === 'running' && !agent.isRoot
      const canMessage = !agent.isRoot
      const label = agent.isRoot ? '★ 主会话' : (agent.label || '未命名')
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
      return el('div', { className: 'dk-agentrow' },
        StatusBadge(agent.status),
        el('div', { className: 'dk-agentname', title: agent.id }, label, el('span', { className: 'dk-mono' }, ' ' + String(agent.id || '').slice(0, 12))),
        el('div', { className: 'dk-agentactions' },
          canMessage ? el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => { setOpenMsg(!openMsg); setNote('') } }, openMsg ? '收起' : '发消息') : null,
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
      const u = st.usage
      return el('div', null,
        el('div', { className: 'dk-h3' }, '智能体监督（' + rows.length + ' 个）· 每 2.5 秒自动刷新'),
        u && u.totals ? el('div', { className: 'dk-tip' }, '模型用量（本会话进程累计）：' + u.totals.calls + ' 次调用 · 输入约 ' + u.totals.input + ' tok · 输出约 ' + u.totals.output + ' tok（启发式估测）') : null,
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
      const group = { running: [], idle: [], done: [] }
      for (const j of jobs) {
        const k = j.status === 'running' ? 'running' : (j.status === 'idle' || j.status === 'pending' || j.status === 'queued') ? 'idle' : 'done'
        group[k].push(j)
      }
      const card = (j) => el('div', { className: 'dk-kcard', key: j.id },
        el('div', { className: 'dk-kid dk-mono' }, j.id),
        el('div', { className: 'dk-kkind' }, j.kind || '任务'),
        el('div', { className: 'dk-agentactions' },
          StatusBadge(j.status),
          (j.status === 'running' || j.status === 'idle') ? el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => kill(j.id) }, '结束') : null,
        ),
      )
      return el('div', null,
        el('div', { className: 'dk-h3' }, '后台任务看板（' + jobs.length + ' 个）· 按状态分列'),
        jobs.length === 0 ? el('div', { className: 'dk-empty' }, '当前没有后台任务。') : el('div', { className: 'dk-kanban' },
          el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '🟢 进行中 ' + group.running.length), group.running.map(card)),
          el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '🔵 等待 ' + group.idle.length), group.idle.map(card)),
          el('div', { className: 'dk-kcol' }, el('div', { className: 'dk-khead' }, '⚪ 已结束 ' + group.done.length), group.done.map(card)),
        ),
      )
    }

    function ScmTab(props) {
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState('')
      const [repo, setRepo] = React.useState('')
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
      const act = async (op, path) => {
        try {
          const res = await host.call('git-op', { op: op, path: path, repo: repo })
          setNote(op + (res && res.ok ? ' ✓' : ' 失败: ' + (res && res.error ? res.error : '未知')))
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
      const sizeText = (b) => { const x = Number(b) || 0; if (x >= 1048576) return (x / 1048576).toFixed(2) + ' MB'; if (x >= 1024) return Math.round(x / 1024) + ' KB'; return x ? x + ' B' : '' }
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
        el('div', { className: 'dk-tip' }, '提示：点击文件夹进入，点击文件预览；图片 ≤4MB、文本 ≤256KB 可直接预览，大文件请用编辑器打开。'),
      )
    }

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
              setError('未发现可用的视觉模型路由：请先点击「管理视觉模型」添加服务商 API Key')
            }
          } else {
            setError('未发现可用的视觉模型路由：请先点击「管理视觉模型」添加服务商 API Key')
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
        patch({ pendingInsert: result, pendingInsertRef: 'vision', insertHint: '' })
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
          el('button', { className: 'dk-btn-sm', onClick: props.onClose }, '收起'),
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

    function MediaTab(props) {
      const s = useStore()
      const st = props.st || { media: [] }
      const media = st.media || []
      const [pathText, setPathText] = React.useState('')
      const [visionRef, setVisionRef] = React.useState(null)
      const [showManager, setShowManager] = React.useState(false)
      const visionEntry = media.find((m) => m.ref === visionRef)
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
      const insert = (m) => { patch({ pendingInsert: refTextOf(m), pendingInsertRef: m.ref, insertHint: '' }) }
      const remove = async (ref) => { try { await host.call('media-delete', { ref: ref }); mediaCache.delete(ref); await refresh() } catch (e) {} }
      return el('div', null,
        el('div', { className: 'dk-h3' }, '媒体图库（' + media.length + '）· 多模态素材'),
        el('div', { className: 'dk-uploadrow' },
          el('input', { type: 'file', accept: 'image/*', className: 'dk-input dk-file', onChange: onFileChange }),
          el('input', { className: 'dk-input dk-pathinput', placeholder: '或输入本机图片路径，如 C:\\...\\img.png', value: pathText, onChange: (ev) => setPathText(ev.target.value) }),
          el('button', { className: 'dk-btn', onClick: importPath, disabled: !pathText.trim() }, '导入'),
          el('button', { className: 'dk-btn-sm', onClick: () => setShowManager(!showManager) }, showManager ? '收起管理' : '管理视觉模型'),
        ),
        showManager ? el(VisionManager, { onClose: () => setShowManager(false) }) : null,
        visionEntry ? el(VisionPanel, { entry: visionEntry, onClose: () => setVisionRef(null) }) : null,
        el('div', { className: 'dk-tip' }, '提示：点击卡片“插入消息”把图片引用写入输入框；“识图”调用外部视觉模型识别；“插入消息”+“识图”搭配可让智能体看图分析。'),
        media.length === 0 ? el('div', { className: 'dk-empty' }, '图库为空。选择文件上传、输入本机路径导入，或让智能体保存图表到图库。') :
          el('div', { className: 'dk-grid' }, media.map((m) => el('div', { className: 'dk-media-card', key: m.ref },
            mediaCache.get(m.ref) ? el('img', { className: 'dk-thumb', src: mediaCache.get(m.ref), alt: m.name }) : el('div', { className: 'dk-thumb dk-thumb-empty' }, '加载中…'),
            el('div', { className: 'dk-media-name', title: m.name }, m.name),
            el('div', { className: 'dk-media-meta' }, m.sizeText || '', m.realPath ? ' · 已解码为真实文件' : ''),
            el('div', { className: 'dk-media-actions' },
              el('button', { className: 'dk-btn-sm', onClick: () => setVisionRef(m.ref) }, '识图'),
              el('button', { className: 'dk-btn-sm dk-btn-primary', onClick: () => insert(m) }, '插入消息'),
              el('button', { className: 'dk-btn-sm dk-btn-danger', onClick: () => remove(m.ref) }, '删除'),
            ),
            s.pendingInsertRef === m.ref ? el('input', { className: 'dk-input dk-mono', readOnly: true, value: s.pendingInsert || '', onFocus: (ev) => ev.target.select() }) : null,
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
      const st = s.state || { agents: [], jobs: [], media: [], workflows: [], logs: [], errors: [], goal: null, usage: null }
      const tabs = [['agents', '智能体'], ['jobs', '任务'], ['scm', '变更'], ['files', '文件'], ['media', '图库'], ['workflows', '工作流'], ['goal', '目标']]
      const w = Math.min(Math.max(s.width || 680, 380), 1180)
      const style = s.pos ? { left: s.pos.x + 'px', top: s.pos.y + 'px', right: 'auto', width: w + 'px' } : { right: 28, top: 84, left: 'auto', width: w + 'px' }
      const onHeadDown = (ev) => {
        try {
          const rect = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : null
          if (rect) patch({ dragging: { dx: ev.clientX - rect.left, dy: ev.clientY - rect.top } })
        } catch (e) {}
      }
      const onResizeDown = (ev) => {
        try { ev.stopPropagation(); patch({ resizing: { startX: ev.clientX, startW: w } }) } catch (e) {}
      }
      const onMove = (ev) => {
        if (store.resizing) {
          const nw = Math.min(Math.max(store.resizing.startW + (store.resizing.startX - ev.clientX), 380), 1180)
          patch({ width: nw })
          return
        }
        if (store.dragging) patch({ pos: { x: ev.clientX - store.dragging.dx, y: ev.clientY - store.dragging.dy } })
      }
      const onUp = () => {
        if (store.resizing) {
          try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('dsh-devkit-width', String(store.width || 680)) } catch (e) {}
          patch({ resizing: null })
        }
        if (store.dragging) patch({ dragging: null })
      }
      const setSkin = (v) => {
        patch({ skin: v })
        try { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem('dsh-devkit-skin', v) } catch (e) {}
      }
      const decoded = (st.media || []).filter((m) => m.realPath).length
      return el('div', { className: 'dk-console', style: style, onMouseMove: onMove, onMouseUp: onUp },
        el('div', { className: 'dk-resize', onMouseDown: onResizeDown, title: '拖拽调整宽度' }),
        el('div', { className: 'dk-head', onMouseDown: onHeadDown },
          el('span', { className: 'dk-title' }, '🧭 开发控制台'),
          tabs.map((t) => el('button', { key: t[0], className: 'dk-tab' + (s.tab === t[0] ? ' dk-tab-active' : ''), onClick: () => patch({ tab: t[0] }) }, t[1])),
          el('select', { className: 'dk-select dk-skinselect', value: s.skin || 'light', title: '界面皮肤（借鉴皮肤中心，即点即换）', onChange: (ev) => setSkin(ev.target.value) },
            SKIN_LIST.map((k) => el('option', { key: k, value: k }, SKIN_NAMES[k]))),
          el('div', { className: 'dk-spacer' }),
          el('button', { className: 'dk-btn-sm', onClick: refresh, title: '立即刷新状态' }, '刷新'),
          s.pos ? el('button', { className: 'dk-btn-sm', onClick: () => patch({ pos: null }), title: '复位面板位置' }, '复位') : null,
          el('button', { className: 'dk-close', onClick: () => patch({ open: false }), title: '关闭' }, '✕'),
        ),
        el('div', { className: 'dk-body' },
          s.tab === 'agents' ? el(AgentsTab, { st: st }) : s.tab === 'jobs' ? el(JobsTab, { st: st }) : s.tab === 'scm' ? el(ScmTab, null) : s.tab === 'files' ? el(FilesTab, null) : s.tab === 'media' ? el(MediaTab, { st: st }) : s.tab === 'workflows' ? el(WorkflowTab, { st: st }) : el(GoalTab, { st: st }),
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
      React.useEffect(() => {
        try {
          const b = document.body
          for (const k of SKIN_LIST) b.classList.remove('dk-skin-' + k)
          b.classList.add('dk-skin-' + (s.skin || 'light'))
        } catch (e) {}
      }, [s.skin])
      if (!s.open) return null
      return el(ConsolePanel, null)
    }

    function DockStrip(props) {
      const s = useStore()
      const st = s.state || { agents: [], jobs: [], media: [] }
      const running = (st.agents || []).filter((a) => a.status === 'running').length
      const total = (st.agents || []).length
      const u = st.usage
      const ut = u ? (u.current && u.current.status === 'streaming' ? u.current : u.last) : null
      const usageText = ut ? '⚡ ' + ut.model + ' · 出 ' + ut.outputTokens + ' tok · ' + (ut.durationMs ? (ut.durationMs / 1000).toFixed(1) + 's' : '生成中') + ' · ' + ut.tps + ' T/s · 入 ' + ut.inputTokens + ' tok' : ''
      React.useEffect(() => {
        if (s.pendingInsert) {
          if (props && props.inputActions) {
            const ok = tryInsertText(props.inputActions, props.input, s.pendingInsert)
            patch({ insertHint: ok ? '文本已插入输入框 ✓' : '未能自动插入，请复制文本框内容' })
            if (ok) { patch({ pendingInsert: null, pendingInsertRef: null }); ctx.timeout(() => patch({ insertHint: '' }), 6000) }
          } else {
            patch({ insertHint: '当前页面无输入框，请手动复制文本框内容' })
          }
        }
      }, [s.pendingInsert])
      return el('div', { className: 'dk-dock' },
        el('span', { className: 'dk-dockstats' }, '🧭 智能体 ' + total + ' · 运行 ' + running + ' · 任务 ' + (st.jobs ? st.jobs.length : 0) + ' · 图库 ' + (st.media ? st.media.length : 0)),
        usageText ? el('span', { className: 'dk-dockusage', title: '实时令牌统计（本会话进程累计）' }, usageText) : null,
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ open: true, tab: 'agents' }) }, '控制台'),
        el('button', { className: 'dk-btn-sm', onClick: () => patch({ open: true, tab: 'media' }) }, '图库'),
        el('button', { className: 'dk-btn-sm', onClick: refresh, title: '立即刷新状态' }, '刷新'),
        s.pendingInsert ? el('input', { className: 'dk-input dk-mono dk-dock-copy', readOnly: true, value: s.pendingInsert, onFocus: (ev) => ev.target.select() }) : null,
        s.pendingInsert ? el('button', { className: 'dk-btn-sm', onClick: () => patch({ pendingInsert: null, pendingInsertRef: null }) }, '✕') : null,
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
        el('div', { className: 'dk-self-line' }, '多模态图库 · 智能体监督 · 任务看板 · Git 变更 · 文件浏览 · 工作流 · 目标总览 · 外部视觉模型识图 · 实时令牌统计 · 皮肤中心'),
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

    styles.insert(".dk-console{position:fixed;z-index:2147483000;width:min(680px,calc(100vw - 40px));height:min(560px,calc(100vh - 110px));display:flex;flex-direction:column;border-radius:12px;overflow:hidden;box-shadow:0 14px 48px rgba(0,0,0,.38);background:#ffffff;color:#1b1d22;font:13px/1.5 -apple-system,'Segoe UI',Roboto,'Microsoft YaHei',sans-serif;pointer-events:auto;border:1px solid rgba(110,120,140,.28)}")
    styles.insert(".dk-head{display:flex;align-items:center;gap:6px;padding:8px 12px;background:rgba(79,140,255,.08);border-bottom:1px solid rgba(110,120,140,.2);cursor:move;user-select:none;flex-wrap:wrap}.dk-title{font-weight:700;margin-right:4px}.dk-tab{border:none;background:transparent;color:inherit;padding:6px 10px;cursor:pointer;font:inherit;border-radius:6px}")
    styles.insert(".dk-tab:hover{background:rgba(110,120,140,.12)}.dk-tab-active{background:rgba(79,140,255,.18);color:#4f8cff;font-weight:600}.dk-spacer{flex:1}.dk-close{border:none;background:transparent;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:6px}.dk-close:hover{background:rgba(239,68,68,.15)}")
    styles.insert(".dk-body{flex:1;overflow:auto;padding:10px 12px}.dk-foot{padding:6px 12px;font-size:11px;color:#8a8f98;border-top:1px solid rgba(110,120,140,.2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dk-h3{font-size:12px;font-weight:700;margin:10px 0 6px}.dk-empty{color:#9aa0aa;padding:14px 4px;font-size:12px}")
    styles.insert(".dk-agentrow{display:flex;align-items:center;gap:8px;padding:7px 4px;border-top:1px solid rgba(110,120,140,.15);flex-wrap:wrap}.dk-agentname{flex:1;min-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dk-agentactions{display:flex;gap:6px;align-items:center}.dk-status{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:#6b7280;min-width:96px}")
    styles.insert(".dk-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:none}.dk-dot-running{background:#22c55e}.dk-dot-idle{background:#3b82f6}.dk-dot-ready{background:#9ca3af}.dk-dot-ended{background:#6b7280;opacity:.5}.dk-dot-unknown{background:#f59e0b}.dk-btn{background:rgba(110,120,140,.14);border:1px solid rgba(110,120,140,.3);color:inherit;border-radius:7px;padding:5px 12px;cursor:pointer;font:inherit}")
    styles.insert(".dk-btn:hover{background:rgba(110,120,140,.24)}.dk-btn:disabled{opacity:.45;cursor:default}.dk-btn-primary{background:#4f8cff;border-color:#4f8cff;color:#fff}.dk-btn-primary:hover{background:#3d7bf0}.dk-btn-sm{background:rgba(110,120,140,.12);border:1px solid rgba(110,120,140,.25);color:inherit;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit;font-size:12px}")
    styles.insert(".dk-btn-sm:hover{background:rgba(110,120,140,.22)}.dk-btn-danger{color:#ef4444;border-color:rgba(239,68,68,.4)}.dk-btn-danger:hover{background:rgba(239,68,68,.12)}.dk-input{background:rgba(110,120,140,.07);border:1px solid rgba(110,120,140,.3);border-radius:6px;padding:5px 8px;color:inherit;font:inherit;width:100%;box-sizing:border-box}")
    styles.insert(".dk-textarea{resize:vertical;min-height:44px}.dk-msgform{flex-basis:100%;display:flex;flex-direction:column;gap:6px;padding:4px 0 2px}.dk-msgrow{display:flex;gap:8px;align-items:center}.dk-note{color:#f59e0b;font-size:11px}.dk-uploadrow{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}")
    styles.insert(".dk-file{width:auto;flex:none}.dk-pathinput{flex:1;min-width:220px}.dk-tip{color:#9aa0aa;font-size:11px;margin:6px 0}.dk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.dk-media-card{border:1px solid rgba(110,120,140,.25);border-radius:10px;padding:8px;display:flex;flex-direction:column;gap:5px}")
    styles.insert(".dk-thumb{width:100%;height:96px;object-fit:cover;border-radius:6px;background:rgba(110,120,140,.1)}.dk-thumb-empty{display:flex;align-items:center;justify-content:center;color:#9aa0aa;font-size:11px}.dk-media-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}")
    styles.insert(".dk-media-meta{font-size:11px;color:#9aa0aa}.dk-media-actions{display:flex;gap:6px}.dk-log{font-size:11px;color:#7c8290;white-space:pre-wrap;word-break:break-all;margin:2px 0;border-left:2px solid rgba(110,120,140,.25);padding-left:6px}.dk-log-err{border-left-color:#ef4444;color:#b45309}")
    styles.insert(".dk-mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all;color:#7c8290}.dk-goal{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:10px;padding:10px 12px}.dk-goal-obj{font-weight:600;margin-bottom:4px}.dk-goal-meta{font-size:12px;color:#6b7280}")
    styles.insert(".dk-goal-block{font-size:12px;color:#ef4444;margin-top:4px}.dk-dock{display:flex;gap:8px;align-items:center;padding:4px 8px;border-radius:8px;background:rgba(110,120,140,.06);border:1px solid rgba(110,120,140,.15);flex-wrap:wrap;font-size:12px}.dk-dockstats{color:#6b7280}.dk-dock-copy{flex:1;min-width:200px}")
    styles.insert(".dk-footbtn{display:inline-flex;align-items:center;gap:6px;background:transparent;border:none;color:inherit;cursor:pointer;font:inherit;padding:4px 8px;border-radius:8px}.dk-footbtn:hover{background:rgba(110,120,140,.14)}.dk-footicon{font-size:14px}.dk-footlabel{font-size:12px}.dk-badge{background:#ef4444;color:#fff;border-radius:9px;padding:0 7px;font-size:11px;line-height:16px}")
    styles.insert(".dk-self{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}.dk-self-title{font-weight:700}.dk-self-line{font-size:12px;color:#6b7280}.dk-self-row{display:flex;gap:8px;margin-top:2px}")
    styles.insert(".dk-select{background:rgba(110,120,140,.08);border:1px solid rgba(110,120,140,.3);border-radius:6px;padding:5px 8px;color:inherit;font:inherit;max-width:220px}.dk-vision{border:1px solid rgba(79,140,255,.35);background:rgba(79,140,255,.07);border-radius:10px;padding:10px 12px;margin:8px 0;display:flex;flex-direction:column;gap:6px}")
    styles.insert(".dk-vision-result{width:100%;min-height:96px;resize:vertical;font-size:12px}.dk-manage-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:4px 0}.dk-manage-in{flex:1;min-width:130px}@media (prefers-color-scheme: dark){.dk-console{background:#1e2127;color:#e6e6e6;border-color:rgba(140,150,170,.3)}.dk-foot,.dk-empty,.dk-tip,.dk-media-meta,.dk-self-line,.dk-goal-meta,.dk-log,.dk-dockstats,.dk-status{color:#8b93a1}.dk-note{color:#fbbf24}}")
    styles.insert(".dk-resize{position:absolute;left:0;top:38%;width:8px;height:64px;cursor:ew-resize;background:rgba(110,120,140,.3);border-radius:0 8px 8px 0;z-index:20}.dk-resize:hover{background:#4f8cff}.dk-skinselect{max-width:76px;font-size:12px;padding:4px 6px}.dk-dockusage{margin-left:8px;font-size:11px;color:#4f8cff;white-space:nowrap}")
    styles.insert(".dk-kanban{display:flex;gap:10px;align-items:flex-start}.dk-kcol{flex:1;min-width:0;background:rgba(110,120,140,.07);border:1px solid rgba(110,120,140,.18);border-radius:8px;padding:8px}.dk-khead{font-size:12px;font-weight:700;margin-bottom:6px}.dk-kcard{background:#ffffff;border:1px solid rgba(110,120,140,.2);border-radius:8px;padding:8px;margin-bottom:6px;box-shadow:0 1px 3px rgba(0,0,0,.06)}")
    styles.insert(".dk-kid{font-size:11px;color:#6b7280;word-break:break-all}.dk-kkind{font-size:12px;margin:2px 0 6px;font-weight:600}.dk-scmrow{display:flex;align-items:center;gap:8px;padding:5px 4px;border-top:1px solid rgba(110,120,140,.15)}.dk-scmflag{width:20px;font-size:11px;color:#b45309}.dk-scmname{flex:1;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}")
    styles.insert(".dk-filepath{flex:1;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#6b7280}.dk-filetable{max-height:260px;overflow:auto;border:1px solid rgba(110,120,140,.2);border-radius:8px;margin-top:6px}.dk-filerow{display:flex;align-items:center;gap:8px;padding:4px 8px;cursor:pointer;border-top:1px solid rgba(110,120,140,.1)}")
    styles.insert(".dk-filerow:first-child{border-top:none}.dk-filerow:hover{background:rgba(79,140,255,.1)}.dk-ficon{flex:none}.dk-fname{flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.dk-fsize{font-size:11px;color:#8a8f98}.dk-preview{margin-top:10px;border:1px solid rgba(110,120,140,.2);border-radius:8px;overflow:hidden}")
    styles.insert(".dk-preview-head{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;font-weight:600;background:rgba(79,140,255,.08);border-bottom:1px solid rgba(110,120,140,.18)}.dk-preview-close{margin-left:auto}.dk-preview-img{display:block;max-width:100%;max-height:320px;margin:0 auto}")
    styles.insert(".dk-preview-text{margin:0;padding:10px;font:12px/1.6 Consolas,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;background:rgba(0,0,0,.03)}.dk-skin-night .dk-console{background:#171a23;color:#dbe2ef;border-color:rgba(140,160,200,.25)}.dk-skin-night .dk-head{background:rgba(120,150,255,.1);border-bottom-color:rgba(140,160,200,.2)}")
    styles.insert(".dk-skin-night .dk-foot{color:#98a2b3;border-top-color:rgba(140,160,200,.2)}.dk-skin-night .dk-tab-active{background:rgba(99,130,255,.28);color:#9db4ff}.dk-skin-night .dk-tab:hover{background:rgba(140,160,200,.14)}.dk-skin-night .dk-agentrow,.dk-skin-night .dk-scmrow{border-top-color:rgba(140,160,200,.16)}")
    styles.insert(".dk-skin-night .dk-empty,.dk-skin-night .dk-note{color:#8b95a8}.dk-skin-night .dk-input,.dk-skin-night .dk-select,.dk-skin-night .dk-textarea{background:#1e2430;color:#dbe2ef;border-color:rgba(140,160,200,.3)}.dk-skin-night .dk-kcard{background:#1e2430;border-color:rgba(140,160,200,.25)}")
    styles.insert(".dk-skin-night .dk-kcol,.dk-skin-night .dk-filetable,.dk-skin-night .dk-preview{border-color:rgba(140,160,200,.25);background:rgba(120,150,255,.05)}.dk-skin-night .dk-preview-head{background:rgba(120,150,255,.14)}.dk-skin-night .dk-preview-text{background:rgba(0,0,0,.25)}.dk-skin-night .dk-dock{background:rgba(23,26,35,.92);color:#dbe2ef}")
    styles.insert(".dk-skin-ocean .dk-console{background:#f5fbff;color:#0f2e3d;border-color:rgba(14,165,233,.3)}.dk-skin-ocean .dk-head{background:rgba(14,165,233,.12)}.dk-skin-ocean .dk-tab-active{background:rgba(14,165,233,.22);color:#0369a1}.dk-skin-ocean .dk-tab:hover{background:rgba(14,165,233,.12)}")
    styles.insert(".dk-skin-ocean .dk-btn-primary{background:#0ea5e9}.dk-skin-forest .dk-console{background:#f6fdf8;color:#12321f;border-color:rgba(22,163,74,.3)}.dk-skin-forest .dk-head{background:rgba(22,163,74,.12)}.dk-skin-forest .dk-tab-active{background:rgba(22,163,74,.22);color:#15803d}.dk-skin-forest .dk-tab:hover{background:rgba(22,163,74,.12)}")
    styles.insert(".dk-skin-forest .dk-btn-primary{background:#16a34a}.dk-skin-sunset .dk-console{background:#fff8f3;color:#3d1d0b;border-color:rgba(249,115,22,.3)}.dk-skin-sunset .dk-head{background:rgba(249,115,22,.12)}.dk-skin-sunset .dk-tab-active{background:rgba(249,115,22,.22);color:#c2410c}.dk-skin-sunset .dk-tab:hover{background:rgba(249,115,22,.12)}")
    styles.insert(".dk-skin-sunset .dk-btn-primary{background:#f97316}.dk-skin-graphite .dk-console{background:#22262e;color:#e2e8f0;border-color:rgba(148,163,184,.3)}.dk-skin-graphite .dk-head{background:rgba(148,163,184,.12)}.dk-skin-graphite .dk-tab-active{background:rgba(148,163,184,.25);color:#cbd5e1}")
    styles.insert(".dk-skin-graphite .dk-tab:hover{background:rgba(148,163,184,.15)}.dk-skin-graphite .dk-foot{color:#94a3b8}.dk-skin-graphite .dk-agentrow,.dk-skin-graphite .dk-scmrow{border-top-color:rgba(148,163,184,.18)}.dk-skin-graphite .dk-empty,.dk-skin-graphite .dk-note{color:#8b95a8}.dk-skin-graphite .dk-input,.dk-skin-graphite .dk-select,.dk-skin-graphite .dk-textarea{background:#2a2f3a;color:#e2e8f0;border-color:rgba(148,163,184,.3)}")
    styles.insert(".dk-skin-graphite .dk-kcard{background:#2a2f3a;border-color:rgba(148,163,184,.25)}.dk-skin-graphite .dk-kcol,.dk-skin-graphite .dk-filetable,.dk-skin-graphite .dk-preview{border-color:rgba(148,163,184,.25);background:rgba(148,163,184,.06)}.dk-skin-graphite .dk-preview-head{background:rgba(148,163,184,.14)}")
    styles.insert(".dk-skin-graphite .dk-dock{background:rgba(34,38,46,.92);color:#e2e8f0}")
  },
}
