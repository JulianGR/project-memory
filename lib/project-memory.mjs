import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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
  const interval = Number.parseInt(value, 10)
  return Number.isInteger(interval) && interval > 0 ? interval : null
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

export async function recordPrompt({ host, event, stateRoot = stateRootFor(), interval = resolveInterval() }) {
  const key = createHash('sha256').update(`${host}\0${event.cwd}\0${event.session_id}`).digest('hex')
  const countInterval = intervalValue(interval) ?? 4
  const stateFile = join(stateRoot, `${key}.json`)
  await mkdir(stateRoot, { recursive: true })
  const count = (await readCount(stateFile)) + 1
  await writeFile(stateFile, JSON.stringify({ count }), 'utf8')
  return { count, due: count % countInterval === 0, interval: countInterval }
}

export function formatReminder(host, state) {
  const message = 'Project memory checkpoint due: update STATUS.md if durable work changed.'
  return host === 'codex' ? JSON.stringify({ systemMessage: message }) : message
}
