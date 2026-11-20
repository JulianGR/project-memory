import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'AGENTS.md')
const markers = ['policy:start', 'policy:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd] = markers

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function hasMemory(content) {
  if (content === null) return false
  let previous = -1
  return markers.every((marker) => {
    const index = content.indexOf(marker)
    if (index <= previous || content.indexOf(marker, index + marker.length) !== -1) return false
    previous = index
    return true
  })
}

function extractPolicy(content) {
  const start = content.indexOf(policyStart)
  const end = content.indexOf(policyEnd)
  if (start === -1 || end === -1 || end < start) throw new Error('Template is missing valid policy markers.')
  return content.slice(start, end + policyEnd.length)
}

export function projectPath(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('cwd is required')
  return resolve(root.trim())
}

async function acquireLock(path) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await open(path, 'wx')
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await setTimeout(25)
    }
  }
  throw new Error('Project memory initialization is already running; retry after it finishes.')
}

async function atomicUpdate(directory, transform) {
  const path = join(directory, 'AGENTS.md')
  const lockPath = join(directory, '.project-memory-init.lock')
  const lock = await acquireLock(lockPath)
  const temporaryPath = join(directory, `.project-memory-${randomUUID()}.tmp`)
  try {
    const current = await readOptional(path)
    const { next, result } = await transform(current)
    if (next === null || next === current) return result
    await writeFile(temporaryPath, next, { encoding: 'utf8', flag: 'wx' })
    if (await readOptional(path) !== current) throw new Error('AGENTS.md changed during initialization; retry without overwriting the newer content.')
    await rename(temporaryPath, path)
    return result
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await lock.close()
    await unlink(lockPath)
  }
}

export async function initializeProject(root) {
  const directory = projectPath(root)
  return atomicUpdate(directory, async (current) => {
    const existing = { agents: current !== null }
    if (hasMemory(current)) return { next: null, result: { existing, updated: false } }
    if (current?.includes('<!-- project-memory:')) throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before initialization.')
    const template = await readFile(templatePath, 'utf8')
    const prefix = current ?? ''
    const next = `${prefix}${prefix ? '\n\n' : ''}${template}`
    return { next, result: { existing, updated: true } }
  })
}

export async function upgradeProject(root) {
  const directory = projectPath(root)
  return atomicUpdate(directory, async (current) => {
    if (current === null) return { next: null, result: { existing: { agents: false, initialized: false }, updated: false } }
    const initialized = hasMemory(current)
    if (!initialized) {
      if (current.includes('<!-- project-memory:')) throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before upgrade.')
      return { next: null, result: { existing: { agents: true, initialized: false }, updated: false } }
    }
    const templatePolicy = extractPolicy(await readFile(templatePath, 'utf8'))
    const currentPolicy = extractPolicy(current)
    if (currentPolicy === templatePolicy) return { next: null, result: { existing: { agents: true, initialized: true }, updated: false } }
    const start = current.indexOf(policyStart)
    const end = current.indexOf(policyEnd) + policyEnd.length
    const next = `${current.slice(0, start)}${templatePolicy}${current.slice(end)}`
    return { next, result: { existing: { agents: true, initialized: true }, updated: true } }
  })
}

export async function projectStatus(root) {
  const content = await readOptional(join(projectPath(root), 'AGENTS.md'))
  return { active: content !== null, initialized: hasMemory(content) }
}

export async function isInitialized(root) {
  return (await projectStatus(root)).initialized
}

export function reviewInstruction(root, initialized) {
  const path = JSON.stringify(join(projectPath(root), 'AGENTS.md'))
  const policy = initialized
    ? 'Follow its maintenance policy and update only the managed state.'
    : `No manual project activation is required. Only if there is durable information to save, read ${JSON.stringify(templatePath)} and incorporate its maintenance policy and managed state into this existing file, preserving current instructions and valid knowledge. Do not add these sections for a no-change review. If managed markers already exist but are incomplete, duplicated, or out of order, leave the file unchanged and report the conflict.`
  return `Project memory maintenance: read ${path}. If the file no longer exists, finish without recreating it. ${policy} Review this turn for meaningful handoff updates: what was done, what was tried (both what worked and what failed/why), and accepted decisions. Write only when useful information changed; otherwise leave the file untouched. When consolidating or when AGENTS.md exceeds ~250 lines, move older resolved work or deep topic details to Markdown files under .memory/ and keep one-line links in Archive index instead of dropping history. Update ~/.project-memory/USER.md only for explicit cross-project user preferences. Perform routine maintenance quietly without announcing the review or adding a second response; surface only real conflicts or failures. If already complete, finish without repeating work.`
}