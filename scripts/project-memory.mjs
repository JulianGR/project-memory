import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const templatesDir = join(dirname(scriptPath), '..', 'templates')
const agentsTemplatePath = join(templatesDir, 'AGENTS.md')
const specTemplatePath = join(templatesDir, 'SPEC.md')
const markers = ['policy:start', 'policy:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd] = markers
const markerPrefix = '<!-- project-memory:'

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
  const tags = content.match(/<!-- project-memory:[^>]*-->/g) ?? []
  const prefixCount = content.split(markerPrefix).length - 1
  if (prefixCount !== tags.length || tags.length !== markers.length) return false
  return tags.every((tag, index) => tag === markers[index])
}

function extractPolicy(content) {
  const start = content.indexOf(policyStart)
  const end = content.indexOf(policyEnd)
  if (start === -1 || end === -1 || end < start) throw new Error('Template is missing valid policy markers.')
  return content.slice(start, end + policyEnd.length)
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

async function createSpecIfMissing(directory) {
  const specPath = join(directory, 'SPEC.md')
  const specTemplate = await readFile(specTemplatePath, 'utf8')
  try {
    await writeFile(specPath, specTemplate, { encoding: 'utf8', flag: 'wx' })
    return { existed: false, created: true }
  } catch (error) {
    if (error.code === 'EEXIST') return { existed: true, created: false }
    throw error
  }
}

async function withProjectLock(directory, action) {
  const lockPath = join(directory, '.project-memory-init.lock')
  const lock = await acquireLock(lockPath)
  try {
    return await action()
  } finally {
    await lock.close()
    await unlink(lockPath)
  }
}

async function atomicWriteIfChanged(path, expectedCurrent, next, directory) {
  if (next === null || next === expectedCurrent) return false
  const temporaryPath = join(directory, `.project-memory-${randomUUID()}.tmp`)
  try {
    await writeFile(temporaryPath, next, { encoding: 'utf8', flag: 'wx' })
    if (await readOptional(path) !== expectedCurrent) {
      throw new Error('AGENTS.md changed concurrently; retry without overwriting newer content.')
    }
    await rename(temporaryPath, path)
    return true
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
}

export async function initializeProject(root) {
  const directory = projectPath(root)
  return withProjectLock(directory, async () => {
    const agentsPath = join(directory, 'AGENTS.md')
    const currentAgents = await readOptional(agentsPath)
    const agentsExisted = currentAgents !== null

    if (!hasMemory(currentAgents) && currentAgents?.includes(markerPrefix)) {
      throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before initialization.')
    }

    let agentsUpdated = false
    if (!hasMemory(currentAgents)) {
      const template = await readFile(agentsTemplatePath, 'utf8')
      const prefix = currentAgents ?? ''
      const next = `${prefix}${prefix ? '\n\n' : ''}${template}`
      agentsUpdated = await atomicWriteIfChanged(agentsPath, currentAgents, next, directory)
    }

    const spec = await createSpecIfMissing(directory)
    return {
      existing: { agents: agentsExisted, spec: spec.existed },
      updated: agentsUpdated || spec.created
    }
  })
}

export async function upgradeProject(root) {
  const directory = projectPath(root)
  return withProjectLock(directory, async () => {
    const agentsPath = join(directory, 'AGENTS.md')
    const specPath = join(directory, 'SPEC.md')
    const currentAgents = await readOptional(agentsPath)
    const specExisted = (await readOptional(specPath)) !== null

    if (currentAgents === null) {
      return { existing: { agents: false, initialized: false, spec: specExisted }, updated: false }
    }
    if (!hasMemory(currentAgents)) {
      if (currentAgents.includes(markerPrefix)) {
        throw new Error('AGENTS.md has incomplete or duplicate project-memory markers; repair them before upgrade.')
      }
      return { existing: { agents: true, initialized: false, spec: specExisted }, updated: false }
    }

    const templatePolicy = extractPolicy(await readFile(agentsTemplatePath, 'utf8'))
    const start = currentAgents.indexOf(policyStart)
    const end = currentAgents.indexOf(policyEnd) + policyEnd.length
    const nextAgents = `${currentAgents.slice(0, start)}${templatePolicy}${currentAgents.slice(end)}`
    const agentsUpdated = await atomicWriteIfChanged(agentsPath, currentAgents, nextAgents, directory)
    const spec = await createSpecIfMissing(directory)

    return {
      existing: { agents: true, initialized: true, spec: spec.existed },
      updated: agentsUpdated || spec.created
    }
  })
}

export async function projectStatus(root) {
  const directory = projectPath(root)
  const [agents, spec] = await Promise.all([
    readOptional(join(directory, 'AGENTS.md')),
    readOptional(join(directory, 'SPEC.md'))
  ])
  return {
    active: agents !== null,
    initialized: hasMemory(agents),
    spec: spec !== null
  }
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
