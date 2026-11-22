import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const templatePath = join(dirname(scriptPath), '..', 'templates', 'AGENTS.md')
const markers = ['policy:start', 'policy:end', 'goal:start', 'goal:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd, goalStart, goalEnd, stateStart] = markers
const legacyMarkers = [policyStart, policyEnd, stateStart, markers[5]]
const markerPrefix = '<!-- project-memory:'

async function readOptional(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function matchesSequence(content, expected) {
  if (content === null) return false
  const tags = content.match(/<!-- project-memory:[^>]*-->/g) ?? []
  const prefixCount = content.split(markerPrefix).length - 1
  if (prefixCount !== tags.length || tags.length !== expected.length) return false
  return tags.every((tag, index) => tag === expected[index])
}

function hasFullMarkers(content) {
  return matchesSequence(content, markers)
}

function hasLegacyMarkers(content) {
  return matchesSequence(content, legacyMarkers)
}

function hasMemory(content) {
  return hasFullMarkers(content) || hasLegacyMarkers(content)
}

function extractBlock(content, startMarker, endMarker, label) {
  const start = content.indexOf(startMarker)
  const end = content.indexOf(endMarker)
  if (start === -1 || end === -1 || end < start) throw new Error(`Template is missing valid ${label} markers.`)
  return content.slice(start, end + endMarker.length)
}

export function projectPath(root) {
  if (typeof root !== 'string' || !root.trim()) throw new TypeError('Project path is required')
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
  throw new Error('Project memory update is already running; retry after it finishes.')
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
    if (await readOptional(path) !== current) throw new Error('AGENTS.md changed concurrently; retry without overwriting newer content.')
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
    if (current?.includes(markerPrefix)) throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before initialization.')
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
    if (!hasMemory(current)) {
      if (current.includes(markerPrefix)) throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before upgrade.')
      return { next: null, result: { existing: { agents: true, initialized: false }, updated: false } }
    }
    const template = await readFile(templatePath, 'utf8')
    const templatePolicy = extractBlock(template, policyStart, policyEnd, 'policy')
    const start = current.indexOf(policyStart)
    const end = current.indexOf(policyEnd) + policyEnd.length
    let next = `${current.slice(0, start)}${templatePolicy}${current.slice(end)}`
    if (hasLegacyMarkers(current)) {
      const templateGoal = extractBlock(template, goalStart, goalEnd, 'goal')
      const stateIndex = next.indexOf(stateStart)
      next = `${next.slice(0, stateIndex)}${templateGoal}\n\n${next.slice(stateIndex)}`
    }
    if (next === current) return { next: null, result: { existing: { agents: true, initialized: true }, updated: false } }
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

function parseProjectOption(args) {
  let project
  for (let index = 0; index < args.length; index += 1) {
    const match = /^--project(?:=(.*))?$/.exec(args[index])
    if (!match) throw new Error(`Unknown option: ${args[index]}`)
    const value = match[1] ?? args[++index]
    if (typeof value !== 'string' || !value.trim() || value.startsWith('--')) throw new Error('Missing value for --project')
    if (project !== undefined) throw new Error('Duplicate option: --project')
    project = value
  }
  if (!project) throw new Error('Specify the target project with --project <directory>.')
  return projectPath(project)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!['init', 'upgrade', 'status'].includes(command)) throw new Error(`Unknown command: ${command || ''}`)
  const root = parseProjectOption(args)
  const output = command === 'init'
    ? await initializeProject(root)
    : command === 'upgrade'
      ? await upgradeProject(root)
      : await projectStatus(root)
  process.stdout.write(`${JSON.stringify(output)}\n`)
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(scriptPath)
  } catch {
    return resolve(process.argv[1]) === resolve(scriptPath)
  }
})()

if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
