import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const templateDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates')

async function createFile(path, content) {
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
    return false
  } catch (error) {
    if (error.code === 'EEXIST') return true
    throw error
  }
}

export async function initializeProject(root) {
  const [status, instructions] = await Promise.all([
    readFile(join(templateDirectory, 'STATUS.md'), 'utf8'),
    readFile(join(templateDirectory, 'AGENT-INSTRUCTIONS.md'), 'utf8')
  ])
  const [existingStatus, existingAgents, existingClaude] = await Promise.all([
    createFile(join(root, 'STATUS.md'), status),
    createFile(join(root, 'AGENTS.md'), instructions),
    createFile(join(root, 'CLAUDE.md'), instructions)
  ])
  return { existing: { status: existingStatus, agents: existingAgents, claude: existingClaude } }
}

export async function isInitialized(root) {
  try {
    await access(join(root, 'STATUS.md'))
    return true
  } catch {
    return false
  }
}

function intervalValue(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const interval = Number(value)
  return Number.isSafeInteger(interval) ? interval : null
}

export function resolveInterval(environment = process.env) {
  return intervalValue(environment.AGENT_MEMORY_INTERVAL) ?? intervalValue(environment.AUTO_UPDATE_CLAUDE_N) ?? 4
}

export function stateRootFor(environment = process.env) {
  return environment.AGENT_MEMORY_HOME || join(homedir(), '.agent-memory')
}

async function readCount(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'))
    return Number.isInteger(state.count) && state.count >= 0 ? state.count : 0
  } catch {
    return 0
  }
}

export function normalizeProjectPath(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('cwd is required')
  const normalized = resolve(root.trim())
  return process.platform === 'win32' && /^[A-Z]:/.test(normalized) ? `${normalized[0].toLowerCase()}${normalized.slice(1)}` : normalized
}

async function acquireLock(lockFile) {
  const deadline = Date.now() + 10000
  while (true) {
    try {
      await writeFile(lockFile, `${process.pid}\n`, { encoding: 'utf8', flag: 'wx' })
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        if (Date.now() - (await stat(lockFile)).mtimeMs > 30000) await unlink(lockFile)
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for state lock: ${lockFile}`)
      await delay(10)
    }
  }
}

async function writeCount(path, count) {
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  await writeFile(temporary, JSON.stringify({ count }), 'utf8')
  await rename(temporary, path)
}

export async function recordPrompt({ host, event, stateRoot = stateRootFor(), interval = resolveInterval() }) {
  if (typeof event?.session_id !== 'string' || !event.session_id.trim()) throw new TypeError('session_id is required')
  const projectPath = normalizeProjectPath(event?.cwd)
  const key = createHash('sha256').update(`${host}\0${projectPath}\0${event.session_id}`).digest('hex')
  const countInterval = intervalValue(interval) ?? 4
  const stateFile = join(stateRoot, `${key}.json`)
  const lockFile = `${stateFile}.lock`
  await mkdir(stateRoot, { recursive: true })
  await acquireLock(lockFile)
  try {
    const count = (await readCount(stateFile)) + 1
    await writeCount(stateFile, count)
    return { count, due: count % countInterval === 0, interval: countInterval }
  } finally {
    try {
      await unlink(lockFile)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

export function formatReminder(host, state) {
  const message = 'Project memory checkpoint due: update STATUS.md if durable work changed.'
  return host === 'codex' ? JSON.stringify({ systemMessage: message }) : message
}
