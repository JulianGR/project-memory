import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const templatePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'AGENTS.md')
const markers = ['policy:start', 'policy:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)

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

export async function initializeProject(root) {
  const directory = projectPath(root)
  const path = join(directory, 'AGENTS.md')
  const lockPath = join(directory, '.project-memory-init.lock')
  const lock = await acquireLock(lockPath)
  const temporaryPath = join(directory, `.project-memory-${randomUUID()}.tmp`)
  try {
    const current = await readOptional(path)
    const existing = { agents: current !== null }
    if (hasMemory(current)) return { existing, updated: false }
    if (current?.includes('<!-- project-memory:')) throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before initialization.')
    const template = await readFile(templatePath, 'utf8')
    const prefix = current ?? ''
    const content = `${prefix}${prefix ? '\n\n' : ''}${template}`
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    if (await readOptional(path) !== current) throw new Error('AGENTS.md changed during initialization; retry without overwriting the newer content.')
    await rename(temporaryPath, path)
    return { existing, updated: true }
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await lock.close()
    await unlink(lockPath)
  }
}

export async function isInitialized(root) {
  return hasMemory(await readOptional(join(projectPath(root), 'AGENTS.md')))
}

export function reviewInstruction(root) {
  const path = JSON.stringify(join(projectPath(root), 'AGENTS.md'))
  return `Project memory maintenance: read ${path} and follow its policy. Review this turn for durable project changes, including non-code work and accepted decisions. Update only the managed state when useful information changed; otherwise leave the file untouched. Consolidate by topic. Preserve applicable decisions and their rationale regardless of age; remove facts only with evidence of supersession or lost applicability. Do not change unrelated instructions or create another memory file. Perform routine maintenance without announcing the review, requesting reminders, or adding a second user-facing summary just for memory. Surface only a failure or a real conflict requiring user input. If this review is already complete and nothing new changed, finish without repeating work.`
}
