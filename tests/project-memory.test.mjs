import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatReminder, initializeProject, recordPrompt } from '../lib/project-memory.mjs'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, '..')
const cliPath = join(projectRoot, 'bin', 'project-memory.mjs')
const reminder = 'Project memory checkpoint due: update STATUS.md if durable work changed.'

function runCli(args, event, environment = {}) {
  const { AGENT_MEMORY_HOME, AGENT_MEMORY_INTERVAL, AUTO_UPDATE_CLAUDE_N, ...baseEnvironment } = process.env
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      env: { ...baseEnvironment, ...environment },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output, errors }))
    child.stdin.end(JSON.stringify(event))
  })
}

function runCliInput(args, input, environment = {}) {
  const { AGENT_MEMORY_HOME, AGENT_MEMORY_INTERVAL, AUTO_UPDATE_CLAUDE_N, ...baseEnvironment } = process.env
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: projectRoot,
      env: { ...baseEnvironment, ...environment },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output, errors }))
    child.stdin.end(input)
  })
}

function runCliAt(binary, cwd, args, event, environment = {}) {
  const { AGENT_MEMORY_HOME, AGENT_MEMORY_INTERVAL, AUTO_UPDATE_CLAUDE_N, ...baseEnvironment } = process.env
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binary, ...args], {
      cwd,
      env: { ...baseEnvironment, ...environment },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let output = ''
    let errors = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output, errors }))
    child.stdin.end(JSON.stringify(event))
  })
}

test('initializeProject creates STATUS.md and identical pointer files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-'))
  const result = await initializeProject(root)
  const agents = await readFile(join(root, 'AGENTS.md'))
  const claude = await readFile(join(root, 'CLAUDE.md'))
  const status = await readFile(join(root, 'STATUS.md'), 'utf8')

  assert.deepEqual(result.existing, { status: false, agents: false, claude: false })
  assert.deepEqual(agents, claude)
  assert.match(status, /## Current state/)
})

test('initializeProject preserves existing project memory files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-'))
  await writeFile(join(root, 'STATUS.md'), 'status before', 'utf8')
  await writeFile(join(root, 'AGENTS.md'), 'agents before', 'utf8')
  await writeFile(join(root, 'CLAUDE.md'), 'claude before', 'utf8')

  const result = await initializeProject(root)

  assert.deepEqual(result.existing, { status: true, agents: true, claude: true })
  assert.equal(await readFile(join(root, 'STATUS.md'), 'utf8'), 'status before')
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'agents before')
  assert.equal(await readFile(join(root, 'CLAUDE.md'), 'utf8'), 'claude before')
})

test('recordPrompt emits a reminder only at the configured interval', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: '/repo', session_id: 's1' }

  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, true)
})

test('recordPrompt keeps counters isolated by session id', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const first = { cwd: '/repo', session_id: 's1' }
  const second = { cwd: '/repo', session_id: 's2' }

  await recordPrompt({ host: 'kimi', event: first, stateRoot, interval: 2 })
  assert.equal((await recordPrompt({ host: 'kimi', event: second, stateRoot, interval: 2 })).count, 1)
  assert.equal((await recordPrompt({ host: 'kimi', event: first, stateRoot, interval: 2 })).due, true)
})

test('recordPrompt keeps counters isolated by host and project path', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const first = { cwd: 'C:\\work\\first', session_id: 's1' }
  const second = { cwd: 'C:\\work\\second', session_id: 's1' }

  await recordPrompt({ host: 'claude', event: first, stateRoot, interval: 2 })
  assert.equal((await recordPrompt({ host: 'kimi', event: first, stateRoot, interval: 2 })).count, 1)
  assert.equal((await recordPrompt({ host: 'claude', event: second, stateRoot, interval: 2 })).count, 1)
})

test('recordPrompt treats equivalent Windows project paths as one counter', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const relativeRoot = relative(process.cwd(), root)
  const alternateRoot = `${root[0].toLowerCase()}${root.slice(1).replaceAll('\\', '/')}/`
  const event = { session_id: 's1' }

  assert.equal((await recordPrompt({ host: 'claude', event: { ...event, cwd: root }, stateRoot, interval: 3 })).count, 1)
  assert.equal((await recordPrompt({ host: 'claude', event: { ...event, cwd: alternateRoot }, stateRoot, interval: 3 })).count, 2)
  assert.equal((await recordPrompt({ host: 'claude', event: { ...event, cwd: relativeRoot.split(sep).join('\\') }, stateRoot, interval: 3 })).count, 3)
})

function ordinals(files) {
  return files.filter((file) => /^\d+\.event$/.test(file)).map((file) => Number(file.slice(0, -'.event'.length))).sort((first, second) => first - second)
}

test('independent prompt processes assign every ordinal and emit every interval-one reminder', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const environment = { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: '1' }
  const event = { cwd: root, session_id: 's1' }

  await runCli(['init'], event, environment)
  await writeFile(join(stateRoot, 'legacy-state.json'), '{"count":1}', 'utf8')

  const results = await Promise.all(Array.from({ length: 40 }, () => runCli(['prompt', '--host', 'claude'], event, environment)))

  assert.ok(results.every((result) => result.code === 0 && result.errors === ''))
  const [eventDirectory] = (await readdir(stateRoot)).filter((file) => file.endsWith('.events'))
  assert.deepEqual(ordinals(await readdir(join(stateRoot, eventDirectory))), Array.from({ length: 40 }, (_, index) => index + 1))
  assert.equal(results.filter((result) => result.output === `${reminder}\n`).length, 40)
  assert.deepEqual((await readdir(stateRoot)).filter((file) => file.endsWith('.due')), [])
})

test('independent prompt processes emit exactly one reminder for every fourth ordinal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const environment = { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: '4' }
  const event = { cwd: root, session_id: 's1' }

  await runCli(['init'], event, environment)
  const results = await Promise.all(Array.from({ length: 20 }, () => runCli(['prompt', '--host', 'claude'], event, environment)))

  assert.ok(results.every((result) => result.code === 0 && result.errors === ''))
  const [eventDirectory] = (await readdir(stateRoot)).filter((file) => file.endsWith('.events'))
  assert.deepEqual(ordinals(await readdir(join(stateRoot, eventDirectory))), Array.from({ length: 20 }, (_, index) => index + 1))
  assert.equal(results.filter((result) => result.output === `${reminder}\n`).length, 5)
})

test('independent prompt processes apply interval changes to their own ordinals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: root, session_id: 's1' }

  await runCli(['init'], event, { AGENT_MEMORY_HOME: stateRoot })
  const results = []
  for (const interval of ['4', '4', '4', '4', '2', '2']) {
    results.push(await runCli(['prompt', '--host', 'claude'], event, { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: interval }))
  }

  assert.ok(results.every((result) => result.code === 0 && result.errors === ''))
  assert.deepEqual(results.map((result) => result.output), ['', '', '', `${reminder}\n`, '', `${reminder}\n`])
  const [eventDirectory] = (await readdir(stateRoot)).filter((file) => file.endsWith('.events'))
  assert.deepEqual(ordinals(await readdir(join(stateRoot, eventDirectory))), [1, 2, 3, 4, 5, 6])
})

test('recordPrompt preserves event records when a stale state artifact is malformed', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: 'C:\\work\\project', session_id: 's1' }
  await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })
  const [eventDirectory] = (await readdir(stateRoot)).filter((file) => file.endsWith('.events'))
  await writeFile(join(stateRoot, `${eventDirectory.slice(0, -'.events'.length)}.json`), '{', 'utf8')

  assert.deepEqual(await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 }), { count: 2, due: false, interval: 4 })
  assert.equal((await readdir(join(stateRoot, eventDirectory))).length, 2)
})

test('recordPrompt rejects missing required hook fields', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))

  await assert.rejects(recordPrompt({ host: 'claude', event: { session_id: 's1' }, stateRoot }), /cwd/)
  await assert.rejects(recordPrompt({ host: 'claude', event: { cwd: 'C:\\work\\project' }, stateRoot }), /session_id/)
  assert.deepEqual(await readdir(stateRoot), [])
})

test('formatReminder uses host-appropriate output', () => {
  assert.deepEqual(JSON.parse(formatReminder('codex', { count: 4, interval: 4 })), { systemMessage: reminder })
  assert.equal(formatReminder('claude', { count: 4, interval: 4 }), reminder)
  assert.equal(formatReminder('kimi', { count: 4, interval: 4 }), reminder)
})

test('prompt marker initializes only exact host payload variants', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const cases = [
    { host: 'claude', event: { prompt: 'AGENT-MEMORY:INIT' }, output: 'Project memory initialized.\n' },
    { host: 'codex', event: { user_prompt: 'agent-memory:init' }, output: '{"systemMessage":"Project memory initialized."}\n' },
    { host: 'kimi', event: { userPrompt: 'agent-memory:init' }, output: 'Project memory initialized.\n' }
  ]

  for (const { host, event, output } of cases) {
    const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
    const result = await runCli(['prompt', '--host', host], { cwd: root, session_id: `${host}-session`, ...event }, { AGENT_MEMORY_HOME: stateRoot })
    assert.deepEqual(result, { code: 0, output, errors: '' })
    assert.equal(await readFile(join(root, 'STATUS.md'), 'utf8').then(() => true), true)
    assert.deepEqual(await readFile(join(root, 'AGENTS.md')), await readFile(join(root, 'CLAUDE.md')))
    const cadence = await runCli(['prompt', '--host', host], { cwd: root, session_id: `${host}-session`, prompt: 'ordinary prompt' }, { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: '1' })
    assert.equal(cadence.output, host === 'codex' ? `{\"systemMessage\":\"${reminder}\"}\n` : `${reminder}\n`)
  }

  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const result = await runCli(['prompt', '--host', 'claude'], { cwd: root, session_id: 'ordinary', prompt: 'please run agent-memory:init' }, { AGENT_MEMORY_HOME: stateRoot })
  assert.deepEqual(result, { code: 0, output: '', errors: '' })
  await assert.rejects(readFile(join(root, 'STATUS.md')))
})

test('installed cache prompt marker preserves existing project memory', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'agent-memory-cache-'))
  const installedRoot = join(cacheRoot, 'auto-update-claude-md')
  const targetRoot = await mkdtemp(join(tmpdir(), 'agent-memory-target-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  await mkdir(installedRoot)
  await Promise.all(['bin', 'lib', 'templates'].map((directory) => cp(join(projectRoot, directory), join(installedRoot, directory), { recursive: true })))
  await writeFile(join(targetRoot, 'STATUS.md'), 'existing status', 'utf8')
  await writeFile(join(targetRoot, 'AGENTS.md'), 'existing agents', 'utf8')
  await writeFile(join(targetRoot, 'CLAUDE.md'), 'existing claude', 'utf8')

  const result = await runCliAt(join(installedRoot, 'bin', 'project-memory.mjs'), targetRoot, ['prompt', '--host', 'codex'], { cwd: targetRoot, session_id: 'cache-session', message: 'agent-memory:init' }, { AGENT_MEMORY_HOME: stateRoot })

  assert.deepEqual(result, { code: 0, output: '{"systemMessage":"Project memory initialized."}\n', errors: '' })
  assert.equal(await readFile(join(targetRoot, 'STATUS.md'), 'utf8'), 'existing status')
  assert.equal(await readFile(join(targetRoot, 'AGENTS.md'), 'utf8'), 'existing agents')
  assert.equal(await readFile(join(targetRoot, 'CLAUDE.md'), 'utf8'), 'existing claude')
})

test('installed cache prompt marker creates byte-identical pointer files in its target project', async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), 'agent-memory-cache-'))
  const installedRoot = join(cacheRoot, 'auto-update-claude-md')
  const targetRoot = await mkdtemp(join(tmpdir(), 'agent-memory-target-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  await mkdir(installedRoot)
  await Promise.all(['bin', 'lib', 'templates'].map((directory) => cp(join(projectRoot, directory), join(installedRoot, directory), { recursive: true })))

  const result = await runCliAt(join(installedRoot, 'bin', 'project-memory.mjs'), targetRoot, ['prompt', '--host', 'kimi'], { cwd: targetRoot, session_id: 'cache-session', input: 'agent-memory:init' }, { AGENT_MEMORY_HOME: stateRoot })

  assert.deepEqual(result, { code: 0, output: 'Project memory initialized.\n', errors: '' })
  assert.match(await readFile(join(targetRoot, 'STATUS.md'), 'utf8'), /## Current state/)
  assert.deepEqual(await readFile(join(targetRoot, 'AGENTS.md')), await readFile(join(targetRoot, 'CLAUDE.md')))
})

test('prompt command stays silent until the project is initialized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const environment = { AGENT_MEMORY_HOME: stateRoot }
  const event = { cwd: root, session_id: 's1' }

  const prompt = await runCli(['prompt', '--host', 'claude'], event, environment)
  const sessionStart = await runCli(['session-start', '--host', 'claude'], event, environment)
  const initialization = await runCli(['init'], event, environment)
  const status = await runCli(['status'], event, environment)

  assert.deepEqual(prompt, { code: 0, output: '', errors: '' })
  assert.deepEqual(sessionStart, { code: 0, output: '', errors: '' })
  assert.equal(initialization.code, 0)
  assert.deepEqual(JSON.parse(status.output), { initialized: true })
})

test('prompt command uses the default interval and legacy interval', async () => {
  const defaultRoot = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const defaultStateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const defaultEvent = { cwd: defaultRoot, session_id: 's1' }
  const defaultEnvironment = { AGENT_MEMORY_HOME: defaultStateRoot }

  await runCli(['init'], defaultEvent, defaultEnvironment)
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await runCli(['prompt', '--host', 'kimi'], defaultEvent, defaultEnvironment)).output, '')
  }
  assert.equal((await runCli(['prompt', '--host', 'kimi'], defaultEvent, defaultEnvironment)).output, `${reminder}\n`)

  const legacyRoot = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const legacyStateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const legacyEvent = { cwd: legacyRoot, session_id: 's1' }
  const legacyEnvironment = { AGENT_MEMORY_HOME: legacyStateRoot, AUTO_UPDATE_CLAUDE_N: '3' }

  await runCli(['init'], legacyEvent, legacyEnvironment)
  assert.equal((await runCli(['prompt', '--host', 'codex'], legacyEvent, legacyEnvironment)).output, '')
  assert.equal((await runCli(['prompt', '--host', 'codex'], legacyEvent, legacyEnvironment)).output, '')
  assert.deepEqual(JSON.parse((await runCli(['prompt', '--host', 'codex'], legacyEvent, legacyEnvironment)).output), { systemMessage: reminder })
})

test('AGENT_MEMORY_INTERVAL overrides the legacy interval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: root, session_id: 's1' }
  const environment = { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: '2', AUTO_UPDATE_CLAUDE_N: '3' }

  await runCli(['init'], event, environment)
  assert.equal((await runCli(['prompt', '--host', 'codex'], event, environment)).output, '')
  assert.deepEqual(JSON.parse((await runCli(['prompt', '--host', 'codex'], event, environment)).output), { systemMessage: reminder })
})

test('invalid interval values fall back to the next configured source or default', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: root, session_id: 's1' }

  await runCli(['init'], event, { AGENT_MEMORY_HOME: stateRoot })
  const legacyEnvironment = { AGENT_MEMORY_HOME: stateRoot, AGENT_MEMORY_INTERVAL: '2junk', AUTO_UPDATE_CLAUDE_N: '3' }
  assert.equal((await runCli(['prompt'], event, legacyEnvironment)).output, '')
  assert.equal((await runCli(['prompt'], event, legacyEnvironment)).output, '')
  assert.equal((await runCli(['prompt'], event, legacyEnvironment)).output, `${reminder}\n`)

  const defaultRoot = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const defaultStateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const defaultEvent = { cwd: defaultRoot, session_id: 's1' }
  const defaultEnvironment = { AGENT_MEMORY_HOME: defaultStateRoot, AGENT_MEMORY_INTERVAL: '1.5', AUTO_UPDATE_CLAUDE_N: '0' }
  await runCli(['init'], defaultEvent, defaultEnvironment)
  for (let index = 0; index < 3; index += 1) assert.equal((await runCli(['prompt'], defaultEvent, defaultEnvironment)).output, '')
  assert.equal((await runCli(['prompt'], defaultEvent, defaultEnvironment)).output, `${reminder}\n`)
})

test('lifecycle commands fail open for malformed hook input without mutating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-project-'))
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  await runCli(['init'], { cwd: root, session_id: 's1' }, { AGENT_MEMORY_HOME: stateRoot })
  const prompt = await runCliInput(['prompt'], '{', { AGENT_MEMORY_HOME: stateRoot })
  const missingFields = await runCli(['prompt'], { cwd: root }, { AGENT_MEMORY_HOME: stateRoot })

  assert.deepEqual(prompt, { code: 0, output: '', errors: '' })
  assert.deepEqual(missingFields, { code: 0, output: '', errors: '' })
  assert.deepEqual(await readdir(stateRoot), [])
})

test('explicit CLI commands report malformed input, failures, and unknown commands', async () => {
  const malformed = await runCliInput(['status'], '{')
  const unknown = await runCliInput(['unknown'], '{}')
  const missingRoot = `Z:\\agent-memory-missing-${Date.now()}`
  const initialization = await runCli(['init'], { cwd: missingRoot, session_id: 's1' })

  assert.equal(malformed.code, 1)
  assert.notEqual(malformed.errors, '')
  assert.equal(unknown.code, 1)
  assert.notEqual(unknown.errors, '')
  assert.equal(initialization.code, 1)
  assert.notEqual(initialization.errors, '')
})
