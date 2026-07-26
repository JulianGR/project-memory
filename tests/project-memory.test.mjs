import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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

test('initializeProject creates STATUS.md and identical pointer files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-'))
  const result = await initializeProject(root)
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
  const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8')
  const status = await readFile(join(root, 'STATUS.md'), 'utf8')

  assert.deepEqual(result.existing, { status: false, agents: false, claude: false })
  assert.equal(agents, claude)
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

test('formatReminder uses host-appropriate output', () => {
  assert.deepEqual(JSON.parse(formatReminder('codex', { count: 4, interval: 4 })), { systemMessage: reminder })
  assert.equal(formatReminder('claude', { count: 4, interval: 4 }), reminder)
  assert.equal(formatReminder('kimi', { count: 4, interval: 4 }), reminder)
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
