#!/usr/bin/env node
// macOS 生成器：复用 Windows 补丁包的同一套词库与翻译引擎（MIT, Johnserf-Seed），
// 针对 macOS 版 GitHub Desktop 3.6.10 的 main.js / renderer.js / crash.js 重新生成并哈希锁定。
//
// 相对 Windows 版新增两级适配：
//   1. zh/dictionary-mac-supplement.json：macOS 构建的菜单源串不带 & 助记符（File / Edit / Copy…），
//      需要单独的译文与来源白名单；
//   2. 大小写别名：macOS 构建与 Windows 构建的英文文案存在大小写差异
//      （Windows: "Create a New Repository on your local drive…"
//        macOS : "Create a New Repository on your Local Drive…"），
//      对仅大小写不同的条目做别名补齐，并沿用引擎的"像界面文案"判定，
//      避免把 octicon 名、CSS 类名、状态键当成 UI 文案翻掉。
//
// 用法: node scripts/build.cjs ["/Applications/GitHub Desktop.app"] [输出目录]
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { patch, loadDictionary } = require('../engine/generate.cjs')
const { candidates } = require('../engine/javascript.cjs')

const root = path.resolve(__dirname, '..')
const sha = b => crypto.createHash('sha256').update(b).digest('hex').toUpperCase()
const VERSION = '3.6.10'
const FILES = ['main.js', 'renderer.js', 'crash.js']

const appBundle = path.resolve(process.argv[2] || '/Applications/GitHub Desktop.app')
const appDir = path.join(appBundle, 'Contents', 'Resources', 'app')
const outDir = path.resolve(process.argv[3] || path.join(root, 'payload'))

const meta = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))
if (meta.name !== 'desktop' || meta.productName !== 'GitHub Desktop' || meta.version !== VERSION) {
  throw new Error(`目标不是 GitHub Desktop ${VERSION}: ${meta.name}/${meta.productName}/${meta.version}`)
}

// ---------- 词库合并 ----------
const basePath = path.join(root, 'zh', 'dictionary.json')
const supplementPath = path.join(root, 'zh', 'dictionary-mac-supplement.json')
const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
const supplement = JSON.parse(fs.readFileSync(supplementPath, 'utf8'))
if (supplement.locale !== 'zh-CN' || !Array.isArray(supplement.entries)) throw new Error('补充词库格式无效')

const byText = new Map(base.entries.map(e => [e.text, e]))
const seen = new Set()
for (const item of supplement.entries) {
  if (seen.has(item.text)) throw new Error(`补充词库重复：${item.text}`)
  seen.add(item.text)
  const existing = byText.get(item.text)
  if (existing) {
    for (const s of item.sources) if (!existing.sources.includes(s)) existing.sources.push(s)
  } else {
    const entry = { text: item.text, translation: item.translation, sources: [...item.sources] }
    base.entries.push(entry)
    byText.set(entry.text, entry)
  }
}

// ---------- 大小写别名 ----------
// 与引擎 pendingCandidate 一致的可翻译判定（引擎未导出该函数，这里保持同一规则）
function plausible(value, origin, displayFragment) {
  if (!/^app\/src\/(?:ui|main-process\/menu)\//.test(origin.source)) return false
  if (/(?:dispatcher|stores|build-test-menu|\/test-|dds-converter|syntax-highlighting)/.test(origin.source)) return false
  if (displayFragment && value.length <= 1200 && /[A-Za-z]/.test(value) && !/https?:|[{};]/.test(value)) return true
  if (value.length < 4 || value.length > 1200 || /https?:|[{};]|^\[|^--|^[a-z]+-\w+|^(?:Failed|Unknown|Unexpected|Unsupported|Error loading|Tried to|Expecting|Invalid .*type)/.test(value)) return false
  return /[a-z][a-z] (?:[A-Za-z]|$)|^[A-Z][a-z]+(?: [A-Z][a-z]+)*[.!?…]?$/.test(value)
}
function isDisplayFragment(node, parent, ancestors) {
  const expression = node.type === 'TemplateElement' ? parent : node
  const call = node.type === 'TemplateElement' ? ancestors[ancestors.length - 2] : parent
  return !!call && call.type === 'CallExpression' && call.callee.type === 'MemberExpression' &&
    !call.callee.computed && call.callee.property.name === 'createElement' &&
    call.arguments.indexOf(expression) >= 2
}

const lowerTranslations = new Map()
for (const [text, entry] of byText) {
  const key = text.toLowerCase()
  if (!lowerTranslations.has(key)) lowerTranslations.set(key, new Set())
  lowerTranslations.get(key).add(entry.translation)
}

const aliasSources = new Map() // text -> Set(sources)
let aliasSkippedAmbiguous = 0
const prepared = []
for (const file of FILES) {
  const srcPath = path.join(appDir, file)
  const mapPath = srcPath + '.map'
  if (!fs.existsSync(mapPath)) throw new Error(`缺少 source map，无法确定翻译范围: ${file}.map`)
  const source = fs.readFileSync(srcPath, 'utf8')
  prepared.push({ file, srcPath, mapPath, source })
  if (file === 'crash.js') continue // 崩溃页文案与 Windows 版一致，无需别名
  for (const item of candidates(source, mapPath).list) {
    if (byText.has(item.value)) continue
    const candidatesFor = lowerTranslations.get(item.value.toLowerCase())
    if (!candidatesFor) continue
    if (candidatesFor.size !== 1) { aliasSkippedAmbiguous++; continue }
    if (!plausible(item.value, item.origin, isDisplayFragment(item.node, item.parent, item.ancestors))) continue
    if (!aliasSources.has(item.value)) aliasSources.set(item.value, new Set())
    aliasSources.get(item.value).add(item.origin.source)
  }
}
for (const [text, sources] of aliasSources) {
  const translation = [...lowerTranslations.get(text.toLowerCase())][0]
  const entry = { text, translation, sources: [...sources], origin: 'case-alias' }
  base.entries.push(entry)
  byText.set(text, entry)
}

const mergedPath = path.join(outDir, '词库-mac-merged.json')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(mergedPath, JSON.stringify(base, null, 2) + '\n')
const dictionary = loadDictionary(mergedPath)

// ---------- 菜单 role 标签 ----------
// mac 构建里 {role:"window"} / {role:"help"} 顶层项、以及 minimize/zoom/close 子项
//由 Electron 生成英文默认标签，源码中没有可替换的字符串字面量。这里做定点插入：
// 每条查找串必须恰好命中一次，插完再解析确认目标对象确实带上了 label 属性。
const ROLE_LABELS = [
  {
    key: 'window-menu',
    find: '{role:"window",submenu:',
    replace: '{label:"窗口",role:"window",submenu:',
  },
  {
    key: 'help-menu',
    find: '{role:"help",submenu:',
    replace: '{label:"帮助",role:"help",submenu:',
  },
  {
    key: 'window-items',
    find: '{role:"minimize"},{role:"zoom"},{role:"close"}',
    replace: '{label:"最小化",role:"minimize"},{label:"缩放",role:"zoom"},{label:"关闭",role:"close"}',
  },
]

function localizeRoleLabels(text) {
  let out = text
  const applied = []
  for (const rule of ROLE_LABELS) {
    const parts = out.split(rule.find)
    // 0 次表示该文件没有这个 role（例如 renderer/crash 没有菜单）；多于 1 次说明构建对不上，必须停。
    if (parts.length === 1) continue
    if (parts.length !== 2) throw new Error(`${rule.key}: 期望恰好命中 1 次，实际 ${parts.length - 1} 次`)
    out = parts.join(rule.replace)
    applied.push(rule.key)
  }
  return { out, applied }
}

// ---------- 生成 ----------
const manifest = { version: VERSION, platform: 'darwin', files: [] }
const report = {
  version: VERSION,
  platform: 'darwin',
  bundle: appBundle,
  dictionaryEntries: dictionary.size,
  caseAliases: aliasSources.size,
  caseAliasSkippedAmbiguous: aliasSkippedAmbiguous,
  roleLabels: [],
  files: {},
  applied: [],
  pending: [],
}

let total = 0
for (const { file, srcPath, mapPath, source } of prepared) {
  const original = Buffer.from(source, 'utf8')
  const translated = patch(source, mapPath, dictionary)
  const roleLabels = localizeRoleLabels(translated.result)
  const outBytes = Buffer.from(roleLabels.out, 'utf8')
  require('../engine/javascript.cjs').parse(roleLabels.out) // 插入后必须仍可解析
  fs.writeFileSync(path.join(outDir, file), outBytes)

  manifest.files.push({ name: file, original: sha(original), patched: sha(outBytes), occurrences: translated.occurrences })
  report.files[file] = {
    originalSha256: sha(original), patchedSha256: sha(outBytes),
    bytes: [original.length, outBytes.length], occurrences: translated.occurrences,
    unique: translated.applied.length, pending: translated.pending.length,
    roleLabels: roleLabels.applied,
  }
  report.roleLabels.push(...roleLabels.applied.map(key => ({ file, key })))
  report.applied.push(...translated.applied.map(x => ({ file, ...x })))
  report.pending.push(...translated.pending.map(x => ({ file, ...x })))
  total += translated.occurrences
  const extra = roleLabels.applied.length ? `，另修正 role 标签 ${roleLabels.applied.length} 处` : ''
  console.log(`${file}: 替换 ${translated.occurrences} 处，唯一文案 ${translated.applied.length} 条，结构校验通过${extra}`)
}

manifest.occurrences = total
manifest.unique = new Set(report.applied.map(x => x.text)).size
manifest.caseAliases = aliasSources.size
manifest.supplementEntries = supplement.entries.length
manifest.roleLabels = report.roleLabels.map(x => `${x.file}:${x.key}`)
manifest.dictionarySha256 = sha(fs.readFileSync(mergedPath))

// 补充词库逐条核验：每条都必须在这轮构建里真正命中，否则视为笔误并停止生成。
const appliedPairs = new Set(report.applied.map(x => `${x.source}\u0000${x.text}`))
const unused = supplement.entries.filter(item => !item.sources.some(s => appliedPairs.has(`${s}\u0000${item.text}`)))
if (unused.length) throw new Error('补充词库存在未命中的条目: ' + unused.map(x => JSON.stringify(x.text)).join(', '))

fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
fs.writeFileSync(path.join(outDir, 'translation-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`合计替换 ${total} 处 / ${manifest.unique} 条不同文案；大小写别名 ${aliasSources.size} 条；role 标签 ${report.roleLabels.length} 处 -> ${outDir}`)
