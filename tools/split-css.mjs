import { readFileSync, writeFileSync } from 'node:fs'
const p = 'src/client.js'
const lines = readFileSync(p, 'utf8').split(/\r?\n/)
const out = []
for (const ln of lines) {
  const m = ln.match(/^(\s*)styles\.insert\("(.*)"\);?\s*$/)
  if (m && ln.length > 900) {
    const indent = m[1]
    const css = m[2]
    const parts = []
    let buf = ''
    let depth = 0
    for (const ch of css) {
      buf += ch
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0 && buf.length > 280) { parts.push(buf); buf = '' }
      }
    }
    if (buf) parts.push(buf)
    for (const part of parts) out.push(indent + 'styles.insert("' + part + '")')
  } else {
    out.push(ln)
  }
}
writeFileSync(p, out.join('\n'))
console.log('rewritten, lines:', out.length)
