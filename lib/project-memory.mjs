import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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

export function normalizeProjectPath(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('cwd is required')
  const normalized = resolve(root.trim())
  return process.platform === 'win32' && /^[A-Z]:/.test(normalized) ? `${normalized[0].toLowerCase()}${normalized.slice(1)}` : normalized
}

async function appendEvent(directory) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, `${randomUUID()}.event`), '', { encoding: 'utf8', flag: 'wx' })
}

async function eventCount(directory) {
  try {
    return (await readdir(directory)).filter((file) => file.endsWith('.event')).length
  } catch (error) {
    if (error.code === 'ENOENT') return 0
    throw error
  }
}

async function claimDue(directory, interval, count) {
  const dueCount = Math.floor(count / interval)
  if (!dueCount) return false
  await mkdir(directory, { recursive: true })
  for (let index = 1; index <= dueCount; index += 1) {
    try {
      await writeFile(join(directory, `${interval}-${index}.due`), '', { encoding: 'utf8', flag: 'wx' })
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
  return false
}

export async function recordPrompt({ host, event, stateRoot = stateRootFor(), interval = resolveInterval() }) {
  if (typeof event?.session_id !== 'string' || !event.session_id.trim()) throw new TypeError('session_id is required')
  const projectPath = normalizeProjectPath(event?.cwd)
  const key = createHash('sha256').update(`${host}\0${projectPath}\0${event.session_id}`).digest('hex')
  const countInterval = intervalValue(interval) ?? 4
  const events = join(stateRoot, `${key}.events`)
  const due = join(stateRoot, `${key}.due`)
  await mkdir(stateRoot, { recursive: true })
  await appendEvent(events)
  const count = await eventCount(events)
  return { count, due: await claimDue(due, countInterval, count), interval: countInterval }
}

export function formatReminder(host, state) {
  const message = 'Project memory checkpoint due: update STATUS.md if durable work changed.'
  return host === 'codex' ? JSON.stringify({ systemMessage: message }) : message
}
