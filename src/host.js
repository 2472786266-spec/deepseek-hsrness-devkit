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
    const sessionQuery = ctx.get('sessionQuery')
    const llm = ctx.get('llm')
    const settings = ctx.get('settings')
    const credentials = ctx.get('credentials')
    const attachments = ctx.get('attachments')
    const tokenMeter = ctx.get('tokenMeter')

    const pick = (obj, keys) => {
      if (obj === null || obj === undefined) return undefined
      for (const k of keys) { const v = obj[k]; if (v !== undefined && v !== null) return v }
      return undefined
    }
    const s = (v) => (v === undefined || v === null) ? '' : String(v)
    const n = (v) => { if (v === undefined || v === null) return null; const x = Number(v); return Number.isFinite(x) ? x : null }
    const now = () => Date.now()
    const errText = (e) => { if (!e) return '未知错误'; return s(pick(e, ['message'])) || String(e) }
    const fmt = (t) => { try { const d = new Date(t); const p = (x) => (x < 10 ? '0' + x : '' + x); return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) } catch (e) { return '' } }
    const sizeText = (b) => { const x = Number(b) || 0; if (x >= 1048576) return (x / 1048576).toFixed(2) + ' MB'; if (x >= 1024) return Math.round(x / 1024) + ' KB'; return x + ' B' }

    const workspaceRoot = sandboxPolicy ? s(sandboxPolicy.workspaceRoot) : ''
    const agentMeta = new Map()
    const workflowMap = new Map()
    const logBuf = []
    const errBuf = []
    const titleCache = new Map()
    let goalCache = null
    let mediaIndex = []
    let mediaLoaded = false
    let mediaUseSubdir = null
    let usageCurrent = null
    let usageLast = null
    const usageTotals = { input: 0, output: 0, calls: 0, startedAt: 0 }
    const modelWindowCache = new Map()
    const contextFor = async (provider, model) => {
      const key = provider + '::' + model
      if (modelWindowCache.has(key)) return modelWindowCache.get(key)
      let win = 0
      try {
        const info = await llm.resolveModelInfo(provider, model)
        win = n(pick(info, ['contextWindow', 'contextLength', 'maxContext'])) || 0
        // 窗口字段可能在 context 子对象里：{ context: { contextWindow } }
        const ctxObj = pick(info, ['context'])
        if (!win && ctxObj && typeof ctxObj === 'object') win = n(pick(ctxObj, ['contextWindow', 'window', 'size'])) || 0
      } catch (e) {}
      if (modelWindowCache.size > 50) modelWindowCache.clear()
      modelWindowCache.set(key, win)
      return win
    }

    const mediaDirName = '.dsh-media'
    const legacyIndexRel = '.dsh-media-index.json'
    const subIndexRel = mediaDirName + '/index.json'
    const legacyFileOf = (ref) => '.dsh-media-' + s(ref) + '.txt'
    const subFileOf = (ref) => mediaDirName + '/' + s(ref) + '.txt'
    const psQuote = (v) => "'" + s(v).replace(/'/g, "''") + "'"

    async function ensureMediaDir() {
      if (mediaUseSubdir !== null) return
      try {
        if (!shell || !fs || !workspaceRoot) { mediaUseSubdir = false; return }
        const rootTarget = await fs.resolve('.', { cwd: workspaceRoot })
        const rootPath = await fs.processPath(rootTarget)
        const dirPath = (rootPath.replace(/[\\/]+$/, '') + '\\' + mediaDirName).replace(/\\/g, '/')
        const command = 'New-Item -ItemType Directory -Force -Path ' + psQuote(dirPath) + ' | Out-Null'
        const spec = shell.resolve({ command: command })
        const res = await shell.run(spec)
        mediaUseSubdir = n(pick(res, ['exitCode', 'code'])) === 0
      } catch (e) { mediaUseSubdir = false }
    }

    async function loadMediaIndex() {
      if (mediaLoaded) return mediaIndex
      mediaLoaded = true
      if (!fs || !workspaceRoot) return mediaIndex
      const readAt = async (rel) => {
        try { return await fs.readText(await fs.resolve(rel, { cwd: workspaceRoot })) } catch (e) { return '' }
      }
      let text = await readAt(subIndexRel)
      if (!text) text = await readAt(legacyIndexRel)
      if (text) {
        try {
          const parsed = JSON.parse(text)
          if (Array.isArray(parsed)) mediaIndex = parsed.map((m) => ({ ref: s(m && m.ref), name: s(m && m.name), mimeType: s(m && m.mimeType), ext: s(m && m.ext), size: n(m && m.size), createdAt: n(m && m.createdAt), realPath: m && m.realPath ? s(m.realPath) : null, file: s(m && m.file) }))
        } catch (e) { mediaIndex = [] }
      }
      return mediaIndex
    }
    async function persistMediaIndex() {
      try {
        if (!fs || !workspaceRoot) return
        await ensureMediaDir()
        const rel = mediaUseSubdir ? subIndexRel : legacyIndexRel
        await fs.writeText(await fs.resolve(rel, { cwd: workspaceRoot }), JSON.stringify(mediaIndex))
      } catch (e) { console.error('devkit: 媒体索引写入失败', e) }
    }

    function b64ToBytes(b64) {
      const bin = atob(b64)
      const u8 = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
      return u8
    }
    // 注意：沙箱 btoa 按 UTF-8 编码字符串，不能用于二进制 base64；手写编码器保证字节安全
    const B64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    function bytesToB64(u8) {
      let out = ''
      for (let i = 0; i < u8.length; i += 3) {
        const b0 = u8[i]
        const b1 = i + 1 < u8.length ? u8[i + 1] : 0
        const b2 = i + 2 < u8.length ? u8[i + 2] : 0
        out += B64_ALPHA[b0 >> 2]
        out += B64_ALPHA[((b0 & 3) << 4) | (b1 >> 4)]
        out += i + 1 < u8.length ? B64_ALPHA[((b1 & 15) << 2) | (b2 >> 6)] : '='
        out += i + 2 < u8.length ? B64_ALPHA[b2 & 63] : '='
      }
      return out
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

    async function tryDecodeReal(entry) {
      try {
        if (!shell || !fs || !workspaceRoot) return null
        const rel = entry.file || legacyFileOf(entry.ref)
        const b64Path = await fs.processPath(await fs.resolve(rel, { cwd: workspaceRoot }))
        const realPath = b64Path.replace(/\.txt$/, '.' + entry.ext)
        const command = '$ErrorActionPreference = "Stop"; $b = [IO.File]::ReadAllText(' + psQuote(b64Path) + '); [IO.File]::WriteAllBytes(' + psQuote(realPath) + ', [Convert]::FromBase64String($b))'
        const spec = shell.resolve({ command: command })
        const res = await shell.run(spec)
        if (n(pick(res, ['exitCode', 'code'])) === 0) return realPath
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
      await ensureMediaDir()
      let rel = legacyFileOf(ref)
      if (mediaUseSubdir) {
        rel = subFileOf(ref)
        try { await fs.writeText(await fs.resolve(rel, { cwd: workspaceRoot }), base64) } catch (e) { rel = legacyFileOf(ref); mediaUseSubdir = false }
      }
      if (!mediaUseSubdir) await fs.writeText(await fs.resolve(rel, { cwd: workspaceRoot }), base64)
      const entry = { ref: ref, name: s(name) || ('图片-' + ref), mimeType: sniff.mimeType, ext: sniff.ext, size: u8.length, createdAt: now(), realPath: null, file: rel }
      entry.realPath = await tryDecodeReal(entry)
      await loadMediaIndex()
      mediaIndex.unshift(entry)
      if (mediaIndex.length > 200) mediaIndex = mediaIndex.slice(0, 200)
      await persistMediaIndex()
      return { ref: entry.ref, name: entry.name, mimeType: entry.mimeType, ext: entry.ext, size: entry.size, createdAt: entry.createdAt, realPath: entry.realPath }
    }

    const agentIdOf = (a) => { try { return s(pick(a, ['id', 'sessionId'])) } catch (e) { return '' } }
    // 父级定位缓存：listDescendants 只覆盖当前根会话树；live 注册表里的子智能体可能属于其他父级
    // 行动时用 listChildren 反查真实直接父级（8 秒 TTL）
    const parentCache = new Map()
    async function findParentOf(childId, debugArr) {
      if (!subagents) return null
      const hit = parentCache.get(childId)
      if (hit && now() - hit.at < 8000) return hit.parent
      // 探针 1：子智能体 Agent 对象自身是否暴露父级字段
      try {
        const child = agents ? agents.get(childId) : undefined
        if (child) {
          if (debugArr) {
            let keys = ''\n            try { keys = String(Object.keys(child).slice(0, 25).join(',')) } catch (e) { keys = 'keys-err' }\n            debugArr.push({ pid: 'SELF-keys', found: false, count: -2, err: keys.slice(0, 180) })\n          }
          const pp = s(pick(child, ['parentSessionId', 'parentId'])) || s(pick(child, ['parent']))
          if (pp) {\n            const pAgent = agents.get(pp)\n            if (pAgent) { parentCache.set(childId, { parent: pAgent, at: now() }); return pAgent }\n            if (debugArr) debugArr.push({ pid: 'SELF-parent-cold:' + pp.slice(0, 20), found: false, count: -3, err: '' })\n          }\n        }\n      } catch (e) {}\n      const candidates = []
      if (agents) {
        try { const ls = agents.list(); if (Array.isArray(ls)) candidates.push(...ls) } catch (e) {}
        try { const roots = agents.roots(); if (roots && roots[0]) candidates.push(roots[0]) } catch (e) {}
      }
      for (const c of candidates) {
        const pid = agentIdOf(c)
        if (!pid || pid === childId) continue
        try {
          const children = await subagents.listChildren(pid)
          if (children && Array.isArray(children) && children.some((ch) => s(pick(ch, ['id', 'sessionId'])) === childId)) {
            parentCache.set(childId, { parent: c, at: now() })
            return c
          }
          if (debugArr) debugArr.push({ pid: pid, found: false, count: children ? children.length : 0, err: '' })
        } catch (e) {
          if (debugArr) debugArr.push({ pid: pid, found: false, count: -1, err: errText(e) })
        }
      }
      parentCache.set(childId, { parent: null, at: now() })
      return null
    }

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
    // 实时令牌统计：包裹每次流式模型调用（借鉴 dsh-web-ui 的 live token stats 思路）
    // v4.5：优先用适配器发出的 usage 块（真实 TokenUsage，含缓存读写），估算仅作流式进度兜底
    ctx.on('llm/stream', function (options, next) {
      let inputTokens = 0
      try {
        if (tokenMeter && typeof tokenMeter.estimateMessage === 'function' && options && Array.isArray(options.messages)) {
          for (const msg of options.messages) {
            try { inputTokens += Number(tokenMeter.estimateMessage({ role: msg && msg.role, content: msg && msg.content })) || 0 } catch (e) {}
          }
        }
      } catch (e) {}
      let inner
      try { inner = next() } catch (e) { throw e }
      const rec = { provider: s(pick(options, ['provider'])), model: s(pick(options, ['model'])), inputTokens: inputTokens, outputTokens: 0, chars: 0, firstTokenMs: null, durationMs: null, tps: 0, status: 'streaming', startedAt: now() }
      usageCurrent = rec
      const src = inner && typeof inner[Symbol.asyncIterator] === 'function' ? inner : null
      if (!src) { usageCurrent = null; return inner }
      return {
        async *[Symbol.asyncIterator]() {
          const t0 = now()
          let firstAt = 0
          let realUsage = null
          try {
            for await (const chunk of src) {
              if (!firstAt) { firstAt = now(); rec.firstTokenMs = firstAt - t0 }
              if (chunk && chunk.type === 'usage' && chunk.usage) realUsage = chunk.usage
              if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') {
                rec.chars += chunk.text.length
                rec.outputTokens = Math.max(1, Math.round(rec.chars / 3.5))
              }
              yield chunk
            }
          } finally {
            const end = now()
            rec.startedAt = t0
            rec.durationMs = end - t0
            rec.status = 'done'
            const u = realUsage || {}
            const inTok = n(u.inputTokens) || rec.inputTokens
            const outTok = n(u.outputTokens) || rec.outputTokens
            rec.tps = rec.durationMs > 0 ? Math.round((outTok / rec.durationMs) * 1000) / 10 : 0
            usageTotals.input += inTok
            usageTotals.output += outTok
            usageTotals.calls += 1
            if (!usageTotals.startedAt) usageTotals.startedAt = t0
            let win = 0
            try { win = await contextFor(rec.provider, rec.model) } catch (e) {}
            const cacheRead = n(u.cacheReadTokens) || 0
            usageLast = { provider: rec.provider, model: rec.model, inputTokens: inTok, outputTokens: outTok, cacheReadTokens: cacheRead, cacheWriteTokens: n(u.cacheWriteTokens) || 0, reasoningTokens: n(u.reasoningTokens) || 0, firstTokenMs: rec.firstTokenMs, durationMs: rec.durationMs, tps: rec.tps, contextWindow: win, contextPct: win > 0 ? Math.min(100, Math.round((inTok + cacheRead) / win * 100)) : null, at: end }
            usageCurrent = null
          }
        },
      }
    })
    ctx.on('goal/changed', (payload) => {
      const ch = payload && payload.change
      const g = (ch && ch.goal) || ch
      if (!g) return
      goalCache = { objective: s(pick(g, ['objective'])), phase: s(pick(g, ['phase'])), rounds: n(pick(g, ['roundsStarted', 'rounds'])), maxRounds: n(pick(g, ['maxGoalRounds'])), blockedReason: s(pick(g, ['blockedReason'])), updatedAt: now() }
    })

    async function titleFor(id) {
      if (titleCache.has(id)) return titleCache.get(id)
      let title = ''
      try {
        if (sessionQuery && typeof sessionQuery.readTitle === 'function') {
          const snap = await sessionQuery.readTitle(id)
          title = s(pick(snap, ['title', 'name', 'text', 'label']))
        }
      } catch (e) {}
      if (titleCache.size > 300) titleCache.clear()
      titleCache.set(id, title)
      return title
    }

    async function buildState() {
      const out = []
      const seen = new Set()
      let rootId = ''
      const liveMap = new Map()
      if (agents) {
        try {
          const roots = agents.roots()
          rootId = roots && roots[0] ? s(pick(roots[0], ['id', 'sessionId'])) : ''
        } catch (e) {}
        try {
          for (const a of agents.list()) { const id = agentIdOf(a); if (id) liveMap.set(id, a) }
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
            const live = liveMap.has(id)
            out.push({ id: id, label: s(pick(d, ['label', 'name'])) || s(m.label) || '', parentId: s(pick(d, ['parentId', 'parent'])), depth: n(pick(d, ['depth'])) || 1, mode: s(pick(d, ['mode'])), activity: s(pick(d, ['activity'])), hasChildren: !!pick(d, ['hasChildren']), isRoot: false, live: live, status: live ? (s(m.status) || 'unknown') : 'ready', createdAt: n(m.createdAt) || n(pick(d, ['createdAt', 'created', 'startedAt', 'started'])) || null })
          }
        } catch (e) {}
      }
      for (const entry of liveMap) {
        const id = entry[0]
        if (seen.has(id)) continue
        seen.add(id)
        const m = agentMeta.get(id) || {}
        const isRoot = id === rootId
        // 状态兜底：插件重启后 agentMeta 为空，优先从 live Agent 对象读状态
        out.push({ id: id, label: s(pick(entry[1], ['label', 'name', 'title'])) || s(m.label) || '', parentId: '', depth: 0, isRoot: isRoot, live: true, status: s(m.status) || s(pick(entry[1], ['status', 'state', 'phase'])) || 'idle', createdAt: n(m.createdAt) })
      }
      for (const row of out) {
        if (!row.label) {
          const t = await titleFor(row.id)
          if (t) row.label = t
        }
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
      let usage = null
      if (usageLast || usageCurrent) {
        const cur = usageCurrent
        usage = {
          last: usageLast,
          current: cur ? { provider: cur.provider, model: cur.model, inputTokens: cur.inputTokens, outputTokens: cur.outputTokens, chars: cur.chars, firstTokenMs: cur.firstTokenMs, durationMs: null, tps: 0, status: cur.status } : null,
          totals: { input: usageTotals.input, output: usageTotals.output, calls: usageTotals.calls },
        }
      }
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
        usage: usage,
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
        const rel = entry.file || legacyFileOf(ref)
        const target = await fs.resolve(rel, { cwd: workspaceRoot })
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
        const agentId = s(pick(args, ['agentId']))
        const text = s(pick(args, ['text'])).trim()
        if (!text || !agentId) return { ok: false, error: '消息或目标为空' }
        const root = agents.roots()[0]
        if (!root) return { ok: false, error: '未找到主会话代理' }
        const rootId = s(pick(root, ['id', 'sessionId']))
        if (agentId === rootId) return { ok: false, error: '不能给主会话自己发消息' }
        const parentId = s(pick(args, ['parentId']))
        let parent = undefined
        if (parentId) {
          parent = agents.get(parentId)
        }
        if (!parent) {
          // 反向定位真实直接父级（可能不属于当前根会话树）
          const debugArr = []
          parent = await findParentOf(agentId, debugArr)
          if (!parent) {
            const dbg = debugArr.length > 0 ? '（诊断: ' + debugArr.map((d) => d.pid.slice(0, 8) + (d.err ? '✗' + d.err.slice(0, 50) : '✓' + d.count)).join(', ') + '）' : ''
            return { ok: false, error: '无法定位该智能体的直接父级会话（父级未激活或已失效）' + dbg }
          }
        }
        // followup 的 options 是必填：{ source, signal }（缺省会被拒绝）
        // 动态宿主域可能没有 AbortController → 鸭子类型 signal 兜底
        const mkSignal = () => (typeof AbortController !== 'undefined' ? new AbortController().signal : { aborted: false, throwIfAborted: function () {}, addEventListener: function () {}, removeEventListener: function () {} })
        const messageId = await subagents.followup(parent, agentId, [{ type: 'text', text: text }], { source: { kind: 'user' }, signal: mkSignal() })
        return { ok: true, messageId: s(messageId) }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('agent-interrupt', async (args) => {
      try {
        if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
        const agentId = s(pick(args, ['agentId']))
        if (!agentId) return { ok: false, error: '目标为空' }
        // authority 必须是 live 祖先：优先用直接父级（findParentOf），否则用根 Agent
        let authority = await findParentOf(agentId)
        if (!authority) {
          authority = agents.roots()[0]
          if (!authority) return { ok: false, error: '未找到授权代理' }
        }
        subagents.interrupt(agentId, { kind: 'ancestor', agent: authority })
        return { ok: true }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('agent-parent', async (args) => {
      try {
        const agentId = s(pick(args, ['agentId']))
        if (!agentId) return { ok: false, error: '目标为空' }
        const debugArr = []
        const parent = await findParentOf(agentId, debugArr)
        return { ok: true, parentId: parent ? agentIdOf(parent) : '', debug: debugArr.slice(0, 5) }
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

    // ── Git 变更（SCM）：真实 git 操作，借鉴 dsh-web-ui 右侧面板的 stage/unstage/discard ──
    // 仓库探测：工作区根目录本身 + 一层子目录（上限 8 个）
    async function detectRepos() {
      const repos = []
      const check = async (abs, rel) => {
        try {
          const info = await fs.stat(await fs.resolve(rel ? rel + '/.git' : '.git', { cwd: workspaceRoot }))
          if (info) repos.push({ path: abs, rel: rel })
        } catch (e) {}
      }
      try {
        const rootAbs = await fs.processPath(await fs.resolve('.', { cwd: workspaceRoot }))
        await check(rootAbs, '')
        if (repos.length === 0) {
          const entries = await fs.listDir(await fs.resolve('.', { cwd: workspaceRoot }))
          for (const e of entries || []) {
            const name = s(pick(e, ['name', 'path', 'basename']))
            const kindRaw = pick(e, ['kind', 'type'])
            const isDir = kindRaw === 'directory' || kindRaw === 'dir' || (e && e.isDirectory === true)
            if (!isDir || !name || name.charAt(0) === '.') continue
            await check(rootAbs + '/' + name, name)
            if (repos.length >= 8) break
          }
        }
      } catch (e) {}
      return repos
    }
    const gitRunAt = async (repoPath, argsStr) => {
      if (!shell) return { out: '', err: '', code: -1 }
      try {
        // DSH 进程注入了不完整的 GIT_CONFIG_* 环境变量（缺 KEY_0），git 启动即报
        // "missing config key GIT_CONFIG_KEY_0"；执行前先清除这三个变量
        const command = 'Remove-Item Env:GIT_CONFIG_COUNT -ErrorAction SilentlyContinue; Remove-Item Env:GIT_CONFIG_VALUE_0 -ErrorAction SilentlyContinue; Remove-Item Env:GIT_CONFIG_KEY_0 -ErrorAction SilentlyContinue; & git -C ' + psQuote(repoPath) + ' ' + argsStr + ' 2>&1'
        const spec = shell.resolve({ command: command })
        const res = await shell.run(spec)
        const t = (v) => (v && typeof v === 'object' && typeof v.text === 'string') ? v.text : s(v)
        return { out: t(pick(res, ['stdout', 'output', 'out'])), err: t(pick(res, ['stderr'])), code: n(pick(res, ['exitCode', 'code'])) }
      } catch (e) { return { out: '', err: errText(e), code: -1 } }
    }
    // 分支降级：不 spawn 任何进程，直接读 .git/HEAD（沙箱禁止外部程序时仍可用）
    async function branchFromHead(repoPath) {
      try {
        let rel = '.git/HEAD'
        if (repoPath && repoPath !== workspaceRoot && repoPath.indexOf(workspaceRoot) === 0) {
          rel = repoPath.slice(workspaceRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/') + '/.git/HEAD'
        }
        const text = await fs.readText(await fs.resolve(rel, { cwd: workspaceRoot }))
        const m = text.trim().match(/^ref:\s*refs\/heads\/(.+)$/)
        if (m) return m[1]
        return text.trim().slice(0, 10) || ''
      } catch (e) { return '' }
    }
    harness.handle('git-status', async (args) => {
      try {
        if (!workspaceRoot) return { ok: false, error: '未找到工作区根目录' }
        const repos = await detectRepos()
        const want = s(pick(args, ['repo']))
        let repo = repos[0] || null
        if (want) repo = repos.find((r) => r.path === want) || repo
        if (!repo) return { ok: false, error: '未在当前工作区找到 git 仓库（支持根目录与一层子目录自动探测）' }
        const r = await gitRunAt(repo.path, 'status --porcelain=v1 --branch')
        const out = r.out || ''
        const errOut = (r.err || '').trim()
        if (out.indexOf('fatal: not a git repository') >= 0 || out.indexOf('not a git repo') >= 0) return { ok: false, error: '该路径不是有效的 git 仓库' }
        if (out.indexOf('fatal:') >= 0) return { ok: false, error: out.split(/\r?\n/).find((x) => x.indexOf('fatal:') >= 0) || 'git 执行失败' }
        // git 命令失败时优雅降级：分支名来自 .git/HEAD，变更列表显示原因
        const gitBlocked = !out.trim() && r.code !== 0
        const lines = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => x)
        let branch = ''
        let start = 0
        if (lines.length > 0 && lines[0].indexOf('## ') === 0) {
          branch = lines[0].slice(3).split('...')[0].trim()
          start = 1
        }
        if (!branch && gitBlocked) branch = await branchFromHead(repo.path)
        const entries = []
        for (let i = start; i < lines.length; i++) {
          const ln = lines[i]
          if (ln.length < 3) continue
          const x = ln.charAt(0)
          const y = ln.charAt(1)
          const path = ln.slice(3)
          entries.push({ x: x, y: y, path: path, staged: x !== ' ' && x !== '?', unstaged: y !== ' ', untracked: x === '?' })
        }
        const errBrief = errOut.split(/\r?\n/).find((x) => x.indexOf('error:') >= 0 || x.indexOf('fatal:') >= 0) || errOut.slice(0, 120)
        const note = gitBlocked ? 'git 命令不可用（' + (errBrief || '未知原因') + '）；分支名来自 .git/HEAD，暂存/丢弃等操作暂不可用' : ''
        return { ok: true, branch: branch, entries: entries, repo: repo, repos: repos, note: note }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('git-op', async (args) => {
      try {
        if (!workspaceRoot) return { ok: false, error: '未找到工作区根目录' }
        const op = s(pick(args, ['op']))
        const path = s(pick(args, ['path']))
        const repoPath = s(pick(args, ['repo'])).trim()
        if (!repoPath) return { ok: false, error: '未指定仓库路径' }
        let argStr = ''
        if (op === 'stage') argStr = 'add -- ' + psQuote(path)
        else if (op === 'stage-all') argStr = 'add -A'
        else if (op === 'unstage') argStr = 'restore --staged -- ' + psQuote(path)
        else if (op === 'discard') argStr = 'restore -- ' + psQuote(path)
        else if (op === 'commit') {
          const message = s(pick(args, ['message'])).trim()
          if (!message) return { ok: false, error: '提交信息不能为空' }
          argStr = 'commit -m ' + psQuote(message.slice(0, 500))
        } else return { ok: false, error: '未知操作' }
        const r = await gitRunAt(repoPath, argStr)
        const out = r.out || ''
        const errOut = (r.err || '').trim()
        const errBrief = errOut.split(/\r?\n/).find((x) => x.indexOf('error:') >= 0 || x.indexOf('fatal:') >= 0) || errOut.slice(0, 120)
        if (r.code !== 0 && !out.trim()) return { ok: false, error: 'git 命令不可用（' + (errBrief || '未知原因') + '）' }
        if (out.indexOf('fatal:') >= 0 || out.indexOf('error:') >= 0) return { ok: false, error: out.split(/\r?\n/).find((x) => x.indexOf('fatal:') >= 0 || x.indexOf('error:') >= 0) || out.slice(0, 200) }
        return { ok: true, op: op }
      } catch (e) { return { ok: false, error: errText(e) } }
    })

    // ── 文件浏览 + 预览（借鉴 dsh-web-ui 右侧面板文件树/预览，简化版）──
    harness.handle('fs-list', async (args) => {
      try {
        if (!fs || !workspaceRoot) return { ok: false, error: '文件服务不可用' }
        const rel = s(pick(args, ['path'])).replace(/^[\\/]+/, '')
        const target = await fs.resolve(rel || '.', { cwd: workspaceRoot })
        const abs = await fs.processPath(target)
        const raw = await fs.listDir(target)
        const entries = (raw || []).map((e) => {
          const name = s(pick(e, ['name', 'path', 'basename']))
          const kindRaw = pick(e, ['kind', 'type'])
          const isDir = kindRaw === 'directory' || kindRaw === 'dir' || (e && e.isDirectory === true)
          return { name: name, isDir: isDir, size: n(pick(e, ['size', 'bytes'])) }
        }).filter((e) => e.name && e.name !== '.dsh-media').sort((a, b) => (a.isDir === b.isDir ? (a.name < b.name ? -1 : 1) : a.isDir ? -1 : 1))
        return { ok: true, abs: abs, rel: rel, entries: entries }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('fs-read', async (args) => {
      try {
        if (!fs || !workspaceRoot) return { ok: false, error: '文件服务不可用' }
        const rel = s(pick(args, ['path'])).replace(/^[\\/]+/, '')
        if (!rel) return { ok: false, error: '路径为空' }
        const target = await fs.resolve(rel, { cwd: workspaceRoot })
        const bytes = await fs.readBytes(target, undefined, 4 * 1024 * 1024 + 64)
        if (!bytes || bytes.length === 0) return { ok: false, error: '文件为空或不可读' }
        const sniff = sniffMime(bytes, rel)
        if (sniff) {
          if (bytes.length > 4 * 1024 * 1024) return { ok: false, error: '图片过大（>4MB），请用图库导入查看' }
          return { ok: true, kind: 'image', dataUrl: 'data:' + sniff.mimeType + ';base64,' + bytesToB64(bytes), size: bytes.length }
        }
        if (bytes.length > 256 * 1024) return { ok: false, error: '文本文件过大（>256KB），仅支持预览小文件' }
        let text = ''
        try { text = new TextDecoder('utf-8', { fatal: false }).decode(bytes) } catch (e) {
          for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + 16384))
        }
        return { ok: true, kind: 'text', text: text, size: bytes.length }
      } catch (e) { return { ok: false, error: errText(e) } }
    })

    harness.handle('vision-routes', async () => {
      try {
        if (!llm) return { ok: false, error: 'LLM 服务不可用' }
        const providers = llm.listProviders()
        const out = []
        for (const p of providers) {
          const pid = s(pick(p, ['id']))
          try {
            const models = await llm.listModels(pid)
            const vision = (models || []).filter((m) => {
              const mods = m.inputModalities
              return Array.isArray(mods) && mods.indexOf('image') >= 0
            }).map((m) => ({ id: s(pick(m, ['id'])), name: s(pick(m, ['name', 'id'])) }))
            if (vision.length > 0) out.push({ provider: pid, name: s(pick(p, ['name', 'id'])) || pid, models: vision })
          } catch (e) {}
        }
        return { ok: true, routes: out }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    async function mediaBytesFor(entry, ref) {
      let bytes = null
      if (entry.realPath) {
        try { bytes = await fs.readBytes(await fs.resolve(entry.realPath), undefined, 12 * 1024 * 1024) } catch (e) { bytes = null }
      }
      if (!bytes || bytes.length === 0) {
        try {
          const rel = entry.file || legacyFileOf(ref)
          bytes = b64ToBytes(await fs.readText(await fs.resolve(rel, { cwd: workspaceRoot })))
        } catch (e) { bytes = null }
      }
      return bytes
    }
    harness.handle('vision-describe', async (args) => {
      try {
        if (!llm || !attachments || !fs) return { ok: false, error: '服务不可用' }
        const ref = s(pick(args, ['ref']))
        const provider = s(pick(args, ['provider']))
        const model = s(pick(args, ['model']))
        const prompt = s(pick(args, ['prompt'])).trim() || '请详细描述这张图片的内容。'
        if (!ref || !provider || !model) return { ok: false, error: '参数不完整' }
        await loadMediaIndex()
        const entry = mediaIndex.find((m) => m.ref === ref)
        if (!entry) return { ok: false, error: '未找到该媒体' }
        const bytes = await mediaBytesFor(entry, ref)
        if (!bytes || bytes.length === 0) return { ok: false, error: '读取图片数据失败' }
        let attachmentRef
        try {
          attachmentRef = await attachments.saveImage({ data: bytes, mediaType: entry.mimeType, name: entry.name })
        } catch (e) {
          if (entry.realPath) return { ok: false, error: '图片附件保存失败: ' + errText(e) }
          return { ok: false, error: '该图片没有已解码的真实文件，识图失败：请在图库中删除后重新上传' }
        }
        let text = ''
        const chunks = llm.stream({ provider: provider, model: model, messages: [{ role: 'user', content: [{ type: 'image', attachment: attachmentRef }, { type: 'text', text: prompt }] }] })
        for await (const chunk of chunks) {
          if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        }
        if (!text) return { ok: false, error: '模型未返回文本（可能 API Key 无效或该模型不支持视觉）' }
        return { ok: true, text: text, provider: provider, model: model }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('vision-add', async (args) => {
      try {
        if (!settings || !credentials) return { ok: false, error: '配置服务不可用' }
        const route = s(pick(args, ['route'])).trim().toLowerCase().replace(/[^a-z0-9-]/g, '-')
        if (!route) return { ok: false, error: '路由名不能为空' }
        const baseURL = s(pick(args, ['baseURL'])).trim()
        const modelId = s(pick(args, ['modelId'])).trim()
        const apiKey = s(pick(args, ['apiKey'])).trim()
        if (!baseURL || !modelId || !apiKey) return { ok: false, error: 'baseURL / 模型 id / API Key 均必填' }
        const op = args && args.opTemplate ? args.opTemplate : null
        const value = args && args.valueTemplate ? args.valueTemplate : null
        if (!op || !value || !Array.isArray(value.models) || value.models.length < 1 || value.models[0] === null || typeof value.models[0] !== 'object') return { ok: false, error: '配置模板无效（客户端版本过旧，请刷新页面）' }
        const envName = 'DSH_VISION_' + route.toUpperCase().replace(/-/g, '_')
        const cw = Math.max(1, Number(pick(args, ['contextWindow'])) || 128000)
        const mt = Math.max(1, Number(pick(args, ['maxTokens'])) || 8192)
        op.op = 'set'
        op.path = ['providers', route]
        value.displayName = s(pick(args, ['displayName'])) || route
        value.apiKeyEnv = envName
        value.api = 'openai-completions'
        value.baseURL = baseURL
        if (!Array.isArray(value.defaultInput) || value.defaultInput.length === 0) value.defaultInput = ['text', 'image']
        value.models[0].id = modelId
        value.models[0].name = s(pick(args, ['modelName'])) || modelId
        value.models[0].input = ['text', 'image']
        value.models[0].contextWindow = cw
        value.models[0].maxTokens = mt
        op.value = value
        await credentials.set(envName, apiKey)
        await settings.mutate('llm-pi-ai', [op])
        return { ok: true, route: route, envName: envName }
      } catch (e) { return { ok: false, error: errText(e) } }
    })
    harness.handle('vision-remove', async (args) => {
      try {
        if (!settings || !credentials) return { ok: false, error: '配置服务不可用' }
        const route = s(pick(args, ['route'])).trim()
        if (!route) return { ok: false, error: '路由名不能为空' }
        const op = args && args.opTemplate ? args.opTemplate : null
        if (!op) return { ok: false, error: '配置模板无效（客户端版本过旧，请刷新页面）' }
        op.op = 'unset'
        op.path = ['providers', route]
        try { await credentials.unset('DSH_VISION_' + route.toUpperCase().replace(/-/g, '_')) } catch (e) {}
        await settings.mutate('llm-pi-ai', [op])
        return { ok: true }
      } catch (e) { return { ok: false, error: errText(e) } }
    })

    const registerTool = (options) => harness.registerTool(ctx, harness.defineTool(options))
    registerTool({
      name: 'devkit_agents',
      description: '查看开发控制台的多智能体监督快照：主会话与所有子智能体（状态/标签/深度/父级）、后台任务、当前目标与工作流。用于监督多智能体工作进展。',
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
        parentId: { type: 'string', description: '其直接父级智能体的 id（深层子智能体必填，devkit_agents 中可查 parentId）' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        try {
          if (!agents || !subagents) return { ok: false, error: '智能体服务不可用' }
          let parent = agents.get(s(pick(args, ['parentId'])))
          if (!parent) parent = await findParentOf(s(pick(args, ['agentId'])))
          if (!parent) return { ok: false, error: '无法定位该智能体的直接父级会话' }
          const mkSignal = () => (typeof AbortController !== 'undefined' ? new AbortController().signal : { aborted: false, throwIfAborted: function () {}, addEventListener: function () {}, removeEventListener: function () {} })
          const messageId = await subagents.followup(parent, s(pick(args, ['agentId'])), [{ type: 'text', text: s(pick(args, ['text'])) }], { source: { kind: 'user' }, signal: mkSignal() })
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
          let authority = await findParentOf(s(pick(args, ['agentId'])))
          if (!authority) authority = agents.roots()[0]
          if (!authority) return { ok: false, error: '未找到授权代理' }
          subagents.interrupt(s(pick(args, ['agentId'])), { kind: 'ancestor', agent: authority })
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
    registerTool({
      name: 'devkit_vision_describe',
      description: '调用已配置的外部视觉大模型识别图库中的一张图片并返回描述（先在图库/管理视觉模型中配置好服务商 API Key）。',
      parameters: {
        ref: { type: 'string', required: true, description: '图库媒体引用 ref（可用 devkit_agents 或图库界面查看）' },
        prompt: { type: 'string', description: '识别提示词，默认“请详细描述这张图片的内容。”' },
        provider: { type: 'string', description: '视觉模型路由（省略时自动选择第一个可用视觉路由）' },
        model: { type: 'string', description: '视觉模型 id（省略时自动选择该路由第一个模型）' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      execute: async (args) => {
        try {
          if (!llm || !attachments || !fs) return { ok: false, error: '视觉服务不可用' }
          const ref = s(pick(args, ['ref']))
          const prompt = s(pick(args, ['prompt'])).trim() || '请详细描述这张图片的内容。'
          await loadMediaIndex()
          const entry = mediaIndex.find((m) => m.ref === ref)
          if (!entry) return { ok: false, error: '未找到该媒体' }
          let provider = s(pick(args, ['provider']))
          let model = s(pick(args, ['model']))
          if (!provider || !model) {
            for (const p of llm.listProviders()) {
              const pid = s(pick(p, ['id']))
              try {
                const models = await llm.listModels(pid)
                const v = (models || []).find((m) => Array.isArray(m.inputModalities) && m.inputModalities.indexOf('image') >= 0)
                if (v) { provider = pid; model = s(pick(v, ['id'])); break }
              } catch (e) {}
            }
          }
          if (!provider || !model) return { ok: false, error: '未找到可用的视觉模型路由，请先配置服务商 API Key' }
          const bytes = await mediaBytesFor(entry, ref)
          if (!bytes || bytes.length === 0) return { ok: false, error: '读取图片数据失败' }
          let attachmentRef
          try {
            attachmentRef = await attachments.saveImage({ data: bytes, mediaType: entry.mimeType, name: entry.name })
          } catch (e) {
            if (entry.realPath) return { ok: false, error: '图片附件保存失败: ' + errText(e) }
            return { ok: false, error: '该图片没有已解码的真实文件，识图失败：请在图库中删除后重新上传' }
          }
          let text = ''
          const chunks = llm.stream({ provider: provider, model: model, messages: [{ role: 'user', content: [{ type: 'image', attachment: attachmentRef }, { type: 'text', text: prompt }] }] })
          for await (const chunk of chunks) {
            if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
          }
          if (!text) return { ok: false, error: '模型未返回文本（可能 API Key 无效或该模型不支持视觉）' }
          return { ok: true, text: text, provider: provider, model: model }
        } catch (e) { return { ok: false, error: errText(e) } }
      },
    })
  },
}
