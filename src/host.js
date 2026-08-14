// DSH DevKit · Host half (Node)
// 用法：把本文件内容作为 cordis_define 的 code.host（内容本身即函数体）。
return {
  apply(ctx) {
    const agents = ctx.get('agents')
    const subagents = ctx.get('subagents')
    const jobs = ctx.get('jobs')
    const fs = ctx.get('fs')
    const goals = ctx.get('goals')
    const shell = ctx.get('shell')
    const sandboxPolicy = ctx.get('sandboxPolicy')

    const pick = (obj, keys) => {
      if (obj === null || obj === undefined) return undefined
      for (const k of keys) { const v = obj[k]; if (v !== undefined && v !== null) return v }
      return undefined
    }
    const s = (v) => (v === undefined || v === null) ? '' : String(v)
    const n = (v) => { if (v === undefined || v === null) return null; const x = Number(v); return Number.isFinite(x) ? x : null }
    const now = () => Date.now()
    const errText = (e) => { if (!e) return '未知错误'; return s(pick(e, ['message'])) || String(e) }
    const shortId = (id) => { const x = s(id); return x.length > 12 ? x.slice(0, 10) + '…' : x }
    const fmt = (t) => { try { const d = new Date(t); const p = (x) => (x < 10 ? '0' + x : '' + x); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) } catch (e) { return '' } }
    const sizeText = (b) => { const x = Number(b) || 0; if (x >= 1048576) return (x / 1048576).toFixed(2) + ' MB'; if (x >= 1024) return Math.round(x / 1024) + ' KB'; return x + ' B' }

    const workspaceRoot = sandboxPolicy ? s(sandboxPolicy.workspaceRoot) : ''
    const agentMeta = new Map()
    const workflowMap = new Map()
    const logBuf = []
    const errBuf = []
    let goalCache = null
    let mediaIndex = []
    let mediaLoaded = false

    const mediaFileOf = (ref) => '.dsh-media-' + s(ref) + '.txt'

    async function loadMediaIndex() {
      if (mediaLoaded) return mediaIndex
      mediaLoaded = true
      try {
        if (!fs || !workspaceRoot) return mediaIndex
        const target = await fs.resolve('.dsh-media-index.json', { cwd: workspaceRoot })
        const text = await fs.readText(target)
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) mediaIndex = parsed.map((m) => ({ ref: s(m && m.ref), name: s(m && m.name), mimeType: s(m && m.mimeType), ext: s(m && m.ext), size: n(m && m.size), createdAt: n(m && m.createdAt), realPath: m && m.realPath ? s(m.realPath) : null }))
      } catch (e) { mediaIndex = [] }
      return mediaIndex
    }
    async function persistMediaIndex() {
      try {
        if (!fs || !workspaceRoot) return
        const target = await fs.resolve('.dsh-media-index.json', { cwd: workspaceRoot })
        await fs.writeText(target, JSON.stringify(mediaIndex))
      } catch (e) { console.error('devkit: 媒体索引写入失败', e) }
    }

    function b64ToBytes(b64) {
      const bin = atob(b64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      return u8
    }
    function bytesToB64(u8) {
      let bin = ''
      const CH = 0x8000
      for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH))
      return btoa(bin)
    }
    function sniffMime(u8, name) {
      const png = u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47
      const jpg = u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff
      const gif = u8.length > 4 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38
      const webp = u8.length > 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
      if (png) return { mimeType: 'image/png', ext: 'png' }
      if (jpg) return { mimeType: 'image/jpeg', ext: 'jpg' }
      if (gif) return { mimeType: 'image/gif', ext: 'gif' }
      if (webp) return { mimeType: 'image/webp', ext: 'webp' }
      const low = s(name).toLowerCase()
      if (low.endsWith('.png')) return { mimeType: 'image/png', ext: 'png' }
      if (low.endsWith('.jpg') || low.endsWith('.jpeg')) return { mimeType: 'image/jpeg', ext: 'jpg' }
      if (low.endsWith('.gif')) return { mimeType: 'image/gif', ext: 'gif' }
      if (low.endsWith('.webp')) return { mimeType: 'image/webp', ext: 'webp' }
      return null
    }
    const psQuote = (v) => "'" + s(v).replace(/'/g, "''") + "'"

    async function tryDecodeReal(entry) {
      try {
        if (!shell || !fs || !workspaceRoot) return null
        const b64Target = await fs.resolve(mediaFileOf(entry.ref), { cwd: workspaceRoot })
        const b64Path = await fs.processPath(b64Target)
        const realPath = b64Path.replace(/\.txt$/, '.' + entry.ext)
        const script = '$ErrorActionPreference="Stop";$b=[IO.File]::ReadAllText(' + psQuote(b64Path) + ');[IO.File]::WriteAllBytes(' + psQuote(realPath) + ',[Convert]::FromBase64String($b))'
        const spec = shell.resolve({ command: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', script] })
        const res = await shell.run(spec)
        const code = n(pick(res, ['exitCode', 'code']))
        if (code === 0) return realPath
      } catch (e) { /* 降级：仅保留 base64 文本 */ }
      return null
    }

    async function saveMedia(name, base64) {
      if (!fs) throw new Error('文件服务不可用')
      if (typeof base64 !== 'string' || base64.length === 0) throw new Error('数据为空')
      if (base64.length > 12 * 1024 * 1024) throw new Error('图片过大（超过 8MB）')
      let u8
      try { u8 = b64ToBytes(base64) } catch (e) { throw new Error('base64 解码失败') }
      if (!u8 || u8.length === 0) throw new Error('图片为空')
      const sniff = sniffMime(u8, s(name))
      if (!sniff) throw new Error('不支持的图片格式（仅支持 PNG/JPEG/GIF/WebP）')
      const ref = 'm' + now().toString(36) + Math.random().toString(36).slice(2, 8)
      const entry = { ref: ref, name: s(name) || ('图片-' + ref), mimeType: sniff.mimeType, ext: sniff.ext, size: u8.length, createdAt: now(), realPath: null }
      const target = await fs.resolve(mediaFileOf(ref), { cwd: workspaceRoot })
      await fs.writeText(target, base64)
      entry.realPath = await tryDecodeReal(entry)
      await loadMediaIndex()
      mediaIndex.unshift(entry)
      if (mediaIndex.length > 200) mediaIndex = mediaIndex.slice(0, 200)
      await persistMediaIndex()
      return { ref: entry.ref, name: entry.name, mimeType: entry.mimeType, ext: entry.ext, size: entry.size, createdAt: entry.createdAt, realPath: entry.realPath }
    }

    const agentIdOf = (a) => { try { return s(pick(a, ['id', 'sessionId'])) } catch (e) { return '' } }

    ctx.on('agent/created', (payload) => {
      const agent = payload && payload.agent
      const id = agentIdOf(agent)
      if (!id) return
      const m = agentMeta.get(id) || {}
      const label = s(pick(agent, ['label', 'name', 'title']))
      if (label) m.label = label
      if (!m.createdAt) m.createdAt = now()
      m.status = 'running'
      agentMeta.set(id, m)
    })
    ctx.on('agent/status', (payload) => {
      const id = agentIdOf(payload && payload.agent)
      const status = payload && payload.status
      if (!id || status === undefined) return
      const m = agentMeta.get(id) || {}
      m.status = status
      agentMeta.set(id, m)
    })
    ctx.on('agent/disposed', (payload) => {
      const id = agentIdOf(payload && payload.agent)
      if (!id) return
      const m = agentMeta.get(id) || {}
      m.status = 'ended'
      m.endedAt = now()
      agentMeta.set(id, m)
    })
    ctx.on('agent/error', (payload) => {
      const id = agentIdOf(payload && payload.agent)
      const message = payload && payload.error !== undefined ? errText(payload.error) : ''
      errBuf.push({ time: now(), id: id, message: message.slice(0, 300) })
      if (errBuf.length > 50) errBuf.shift()
    })
    ctx.on('subagent/start', (info) => {
      const id = s(pick(info, ['sessionId', 'id', 'agentId']))
      if (!id) return
      const m = agentMeta.get(id) || {}
      const label = s(pick(info, ['label', 'name', 'title']))
      if (label) m.label = label
      if (!m.createdAt) m.createdAt = now()
      m.status = 'running'
      agentMeta.set(id, m)
    })
    ctx.on('subagent/end', (info) => {
      const id = s(pick(info, ['sessionId', 'id', 'agentId']))
      if (!id) return
      const m = agentMeta.get(id) || {}
      m.endedAt = now()
      agentMeta.set(id, m)
    })
    ctx.on('workflow/start', (info) => {
      const id = s(pick(info, ['id', 'runId', 'name']))
      workflowMap.set(id || ('wf-' + now()), { id: id || '', name: s(pick(info, ['name', 'label'])) || id || '', status: 'running', phase: '', startedAt: now() })
    })
    ctx.on('workflow/phase', (info, title) => {
      const id = s(pick(info, ['id', 'runId', 'name']))
      if (id && workflowMap.has(id)) { const w = workflowMap.get(id); w.phase = s(title); w.updatedAt = now() }
    })
    ctx.on('workflow/end', (info) => {
      const id = s(pick(info, ['id', 'runId', 'name']))
      if (id && workflowMap.has(id)) { const w = workflowMap.get(id); w.status = 'ended'; w.updatedAt = now() }
    })
    ctx.on('workflow/log', (info, message) => {
      logBuf.push({ time: now(), message: s(message).slice(0, 500) })
      if (logBuf.length > 100) logBuf.shift()
    })
    ctx.on('goal/changed', (payload) => {
      const ch = payload && payload.change
      const g = (ch && ch.goal) || ch
      if (!g) return
      goalCache = { objective: s(pick(g, ['objective'])), phase: s(pick(g, ['phase'])), rounds: n(pick(g, ['roundsStarted', 'rounds'])), maxRounds: n(pick(g, ['maxGoalRounds'])), blockedReason: s(pick(g, ['blockedReason'])), updatedAt: now() }
    })

    async function buildState() {
      const out = []
      const seen = new Set()
      let rootId = ''
      if (agents) {
        try {
          const roots = agents.roots()
          rootId = roots && roots[0] ? s(pick(roots[0], ['id', 'sessionId'])) : ''
        } catch (e) {}
        try {
          for (const a of agents.list()) {
            const id = agentIdOf(a)
            if (!id || seen.has(id)) continue
            seen.add(id)
            const m = agentMeta.get(id) || {}
            out.push({ id: id, label: s(pick(a, ['label', 'name', 'title'])) || s(m.label) || shortId(id), status: s(m.status) || 'unknown', isRoot: id === rootId, depth: 0, createdAt: n(m.createdAt) })
          }
        } catch (e) {}
      }
      if (subagents && rootId) {
        try {
          const desc = await subagents.listDescendants(rootId)
          for (const d of desc) {
            const id = s(pick(d, ['id', 'sessionId']))
            if (!id || seen.has(id)) continue
            seen.add(id)
            const m = agentMeta.get(id) || {}
            out.push({ id: id, label: s(pick(d, ['label', 'name'])) || s(m.label) || shortId(id), status: s(m.status) || 'ready', isRoot: false, depth: n(pick(d, ['depth'])) || 1, createdAt: n(m.createdAt) || n(pick(d, ['createdAt'])) })
          }
        } catch (e) {}
      }
      let jobList = []
      if (jobs) {
        try {
          const caller = (agents && rootId) ? agents.get(rootId) : undefined
          const snaps = caller ? jobs.list(caller) : jobs.list()
          jobList = (snaps || []).map((j) => ({ id: s(pick(j, ['id', 'jobId'])), kind: s(pick(j, ['kind', 'type'])), status: s(pick(j, ['status'])), label: s(pick(j, ['label', 'title', 'name'])) }))
        } catch (e) {}
      }
      let goal = null
      try {
        if (goals && agents && rootId) {
          const rootAgent = agents.get(rootId)
          if (rootAgent) {
            const gv = goals.get(rootAgent)
            if (gv) goal = { objective: s(pick(gv, ['objective'])), phase: s(pick(gv, ['phase'])), rounds: n(pick(gv, ['roundsStarted', 'rounds'])), maxRounds: n(pick(gv, ['maxGoalRounds'])), blockedReason: s(pick(gv, ['blockedReason'])) }
          }
        }
      } catch (e) {}
      if (!goal) goal = goalCache
      let media = []
      try { media = (await loadMediaIndex()).map((m) => ({ ref: s(m.ref), name: s(m.name), mimeType: s(m.mimeType), size: n(m.size), sizeText: sizeText(m.size), realPath: m.realPath ? s(m.realPath) : null, timeText: fmt(n(m.createdAt)) })) } catch (e) {}
      return {
        rootSessionId: rootId,
        agents: out,
        jobs: jobList,
        goal: goal,
        workflows: Array.from(workflowMap.values()).map((w) => ({ id: w.id, name: w.name, status: w.status, phase: w.phase, timeText: fmt(w.startedAt) })),
        logs: logBuf.slice(-25).map((l) => ({ time: l.time, timeText: fmt(l.time), message: l.message })),
        errors: errBuf.slice(-15).map((er) => ({ time: er.time, timeText: fmt(er.time), id: er.id, message: er.message })),
        media: media,
        mediaRoot: workspaceRoot,
        updatedAt: now(),
      }
    }

    harness.handle('state', async () => {
      try { return { ok: true, state: await buildState() } } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('media-save', async (args) => {
      try { const entry = await saveMedia(s(pick(args, ['name'])), s(pick(args, ['base64']))); return { ok: true, entry: entry } } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('media-import', async (args) => {
      try {
        const path = s(pick(args, ['path'])).trim()
        if (!path) return { ok: false, error: '路径为空' }
        if (!fs) return { ok: false, error: '文件服务不可用' }
        const target = await fs.resolve(path)
        const bytes = await fs.readBytes(target, undefined, 12 * 1024 * 1024)
        if (!bytes || bytes.length === 0) return { ok: false, error: '文件为空或不可读' }
        const name = path.split(/[\\/]/).pop() || '图片'
        const entry = await saveMedia(name, bytesToB64(bytes))
        return { ok: true, entry: entry }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('media-read', async (args) => {
      try {
        const ref = s(pick(args, ['ref']))
        await loadMediaIndex()
        const entry = mediaIndex.find((m) => m.ref === ref)
        if (!entry) return { ok: false, error: '未找到该媒体' }
        const target = await fs.resolve(mediaFileOf(ref), { cwd: workspaceRoot })
        const base64 = await fs.readText(target)
        return { ok: true, entry: { ref: entry.ref, name: entry.name, mimeType: entry.mimeType, ext: entry.ext, size: entry.size, createdAt: entry.createdAt, realPath: entry.realPath ? s(entry.realPath) : null }, base64: base64 }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('media-delete', async (args) => {
      try {
        const ref = s(pick(args, ['ref']))
        await loadMediaIndex()
        const before = mediaIndex.length
        mediaIndex = mediaIndex.filter((m) => m.ref !== ref)
        if (mediaIndex.length !== before) await persistMediaIndex()
        return { ok: true }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('agent-message', async (args) => {
      try {
        if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
        const parent = (args && agents.get(s(pick(args, ['sessionId'])))) || agents.roots()[0]
        if (!parent) return { ok: false, error: '未找到当前会话代理' }
        const text = s(pick(args, ['text'])).trim()
        const agentId = s(pick(args, ['agentId']))
        if (!text || !agentId) return { ok: false, error: '消息或目标为空' }
        const messageId = await subagents.followup(parent, agentId, [{ type: 'text', text: text }], {})
        return { ok: true, messageId: s(messageId) }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('agent-interrupt', async (args) => {
      try {
        if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
        const authority = (args && agents.get(s(pick(args, ['sessionId'])))) || agents.roots()[0]
        if (!authority) return { ok: false, error: '未找到授权代理' }
        const agentId = s(pick(args, ['agentId']))
        if (!agentId) return { ok: false, error: '目标为空' }
        subagents.interrupt(agentId, authority)
        return { ok: true }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('job-kill', async (args) => {
      try {
        if (!jobs) return { ok: false, error: '任务服务不可用' }
        const caller = agents ? agents.get(s(pick(args, ['sessionId']))) : undefined
        const result = jobs.kill(s(pick(args, ['jobId'])), caller, 'devkit console')
        return { ok: true, result: s(result) }
      } catch (e) { return { ok: false, error: errText(e) } }
    })

    const registerTool = (options) => harness.registerTool(ctx, harness.defineTool(options))
    registerTool({
      name: 'devkit_agents',
      description: '查看开发控制台的多智能体监督快照：主会话与所有子智能体（状态/标签）、后台任务、当前目标与工作流。用于监督多智能体工作进展。',
      parameters: {},
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async () => {
        const st = await buildState()
        return { agents: st.agents, jobs: st.jobs, goal: st.goal || null, workflows: st.workflows }
      },
    })
    registerTool({
      name: 'devkit_send_agent_message',
      description: '向一个子智能体发送一条新消息（作为它的下一轮），可用于继续或追加任务。',
      parameters: {
        agentId: { type: 'string', required: true, description: '子智能体的 id（可用 devkit_agents 查询）' },
        text: { type: 'string', required: true, description: '要发送的消息内容' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        try {
          if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
          const parent = agents.roots()[0]
          if (!parent) return { ok: false, error: '未找到主会话代理' }
          const messageId = await subagents.followup(parent, s(pick(args, ['agentId'])), [{ type: 'text', text: s(pick(args, ['text'])) }], {})
          return { ok: true, messageId: s(messageId) }
        } catch (e) { return { ok: false, error: errText(e) } }
      },
    })
    registerTool({
      name: 'devkit_interrupt_agent',
      description: '打断一个正在运行的子智能体的当前轮次（其已排队的消息保留）。',
      parameters: {
        agentId: { type: 'string', required: true, description: '子智能体的 id' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        try {
          if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
          const authority = agents.roots()[0]
          if (!authority) return { ok: false, error: '未找到主会话代理' }
          subagents.interrupt(s(pick(args, ['agentId'])), authority)
          return { ok: true }
        } catch (e) { return { ok: false, error: errText(e) } }
      },
    })
    registerTool({
      name: 'devkit_media_save',
      description: '把一张图片（base64 编码）保存到用户网页端的媒体图库，供用户在“开发控制台 → 图库”查看。适用于把生成的图表或截图交付给用户。',
      parameters: {
        name: { type: 'string', description: '显示名称' },
        base64: { type: 'string', required: true, description: '图片的 base64 数据（不含 data: 前缀）' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        try {
          const entry = await saveMedia(s(pick(args, ['name'])), s(pick(args, ['base64'])))
          return { ok: true, ref: entry.ref, name: entry.name, size: entry.size, realPath: entry.realPath || null }
        } catch (e) { return { ok: false, error: errText(e) } }
      },
    })
  },
}
