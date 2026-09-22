import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeProject, isInitialized } from '../lib/project-memory.mjs'

const testDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(testDirectory, '..')
const cliPath = join(projectRoot, 'bin', 'project-memory.mjs')
const policyStart = '<!-- project-memory:policy:start -->'
const policyEnd = '<!-- project-memory:policy:end -->'
const stateStart = '<!-- project-memory:state:start -->'
const stateEnd = '<!-- project-memory:state:end -->'
const markers = [policyStart, policyEnd, stateStart, stateEnd]

async function temporaryDirectory(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const tempRoot = resolve(tmpdir()).toLowerCase()
  const candidate = resolve(root).toLowerCase()
  assert.equal(candidate.startsWith(`${tempRoot}${sep}`.toLowerCase()), true)
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function runCli(args, event) {
  return runCliInput(args, JSON.stringify(event))
}

function runCliInput(args, input) {
  return runCliAt(cliPath, projectRoot, args, input)
}

function runCliAt(binary, cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binary, ...args], {
      cwd,
      env: { ...process.env },
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

function markerCount(content, marker) {
  return content.split(marker).length - 1
}

function assertMarkers(content) {
  for (const marker of markers) assert.equal(markerCount(content, marker), 1)
  const positions = markers.map((marker) => content.indexOf(marker))
  assert.deepEqual([...positions].sort((first, second) => first - second), positions)
}

function hookOutput(result, eventName) {
  assert.equal(result.code, 0)
  assert.equal(result.errors, '')
  const payload = JSON.parse(result.output)
  assert.deepEqual(Object.keys(payload), ['hookSpecificOutput'])
  assert.deepEqual(Object.keys(payload.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName'])
  assert.equal(payload.hookSpecificOutput.hookEventName, eventName)
  assert.equal(typeof payload.hookSpecificOutput.additionalContext, 'string')
  assert.match(payload.hookSpecificOutput.additionalContext, /AGENTS\.md/)
  return payload
}

async function installedBinary(t) {
  const cacheRoot = await temporaryDirectory(t, 'agent-memory-cache-')
  const installedRoot = join(cacheRoot, 'project-memory')
  await mkdir(installedRoot)
  await Promise.all(['bin', 'lib', 'templates'].map((directory) => cp(join(projectRoot, directory), join(installedRoot, directory), { recursive: true })))
  return join(installedRoot, 'bin', 'project-memory.mjs')
}

test('initializeProject creates only AGENTS.md with the four protocol markers', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')

  const result = await initializeProject(root)
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')

  assert.deepEqual(result, { existing: { agents: false }, updated: true })
  assertMarkers(agents)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('initializeProject preserves existing instructions and does not import NOTES.md', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  const original = 'Local instructions that must remain intact.\n'
  const notes = 'This unrelated file must not become project memory.\n'
  await writeFile(join(root, 'AGENTS.md'), original, 'utf8')
  await writeFile(join(root, 'NOTES.md'), notes, 'utf8')

  const result = await initializeProject(root)
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')

  assert.deepEqual(result, { existing: { agents: true }, updated: true })
  assert.equal(agents.startsWith(original), true)
  assert.equal(agents.includes(notes), false)
  assertMarkers(agents)
  assert.equal(await readFile(join(root, 'NOTES.md'), 'utf8'), notes)
  assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md', 'NOTES.md'])
})

test('initializeProject is a byte and mtime no-op for initialized AGENTS.md', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  await initializeProject(root)
  const agentsPath = join(root, 'AGENTS.md')
  const knownTime = new Date('2000-01-02T03:04:05.000Z')
  await utimes(agentsPath, knownTime, knownTime)
  const before = await stat(agentsPath, { bigint: true })
  const content = await readFile(agentsPath)

  const result = await initializeProject(root)
  const after = await stat(agentsPath, { bigint: true })

  assert.deepEqual(result, { existing: { agents: true }, updated: false })
  assert.deepEqual(await readFile(agentsPath), content)
  assert.equal(after.mtimeNs, before.mtimeNs)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('isInitialized requires four unique ordered markers and rejects arbitrary instructions', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  await writeFile(join(root, 'AGENTS.md'), 'arbitrary instructions', 'utf8')
  assert.equal(await isInitialized(root), false)

  await initializeProject(root)
  const valid = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.equal(await isInitialized(root), true)

  const cases = [
    valid.replace(stateEnd, `${stateEnd}\n${stateEnd}`),
    `${policyStart}\n${stateStart}\n${policyEnd}\n${stateEnd}\n`,
    `${policyStart}\n${policyEnd}\n${stateStart}\n`
  ]
  for (const content of cases) {
    await writeFile(join(root, 'AGENTS.md'), content, 'utf8')
    assert.equal(await isInitialized(root), false)
  }
})

test('initializeProject rejects partial markers without mutating files', async (t) => {
  const partialDocuments = [
    `${policyStart}\npartial\n${policyEnd}\n`,
    `${stateStart}\npartial\n${stateEnd}\n`,
    `${policyStart}\npartial\n${stateStart}\npartial\n${stateEnd}\n`
  ]

  for (const partial of partialDocuments) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    const notes = 'Keep this unrelated file unchanged.\n'
    await writeFile(join(root, 'AGENTS.md'), partial, 'utf8')
    await writeFile(join(root, 'NOTES.md'), notes, 'utf8')
    const before = await Promise.all(['AGENTS.md', 'NOTES.md'].map((file) => readFile(join(root, file), 'utf8')))

    await assert.rejects(initializeProject(root))

    const after = await Promise.all(['AGENTS.md', 'NOTES.md'].map((file) => readFile(join(root, file), 'utf8')))
    assert.deepEqual(after, before)
    assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md', 'NOTES.md'])
  }
})

test('concurrent initialization writes one complete AGENTS.md document', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  const results = await Promise.all(Array.from({ length: 8 }, () => initializeProject(root)))

  assert.equal(results.filter(({ updated }) => updated).length, 1)
  assert.equal(results.filter(({ existing }) => existing.agents === false).length, 1)
  for (const result of results) assert.deepEqual(Object.keys(result).sort(), ['existing', 'updated'])
  assert.equal(await isInitialized(root), true)
  assertMarkers(await readFile(join(root, 'AGENTS.md'), 'utf8'))
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('explicit init and status diagnose only the target project', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')

  const before = await runCli(['status'], { cwd: root })
  const init = await runCli(['init'], { cwd: root })
  const after = await runCli(['status'], { cwd: root })

  assert.deepEqual(JSON.parse(before.output), { initialized: false })
  assert.equal(init.code, 0)
  assert.equal(init.errors, '')
  assert.deepEqual(JSON.parse(init.output), { existing: { agents: false }, updated: true })
  assert.deepEqual(JSON.parse(after.output), { initialized: true })
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('explicit commands fail with code one for malformed input or missing cwd', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  for (const command of ['init', 'status']) {
    const malformed = await runCliInput([command], '{')
    const missing = await runCli([command], { cwd: '' })
    assert.equal(malformed.code, 1)
    assert.notEqual(malformed.errors, '')
    assert.equal(missing.code, 1)
    assert.notEqual(missing.errors, '')
  }

  const unknown = await runCliInput(['unknown'], '{}')
  assert.equal(unknown.code, 1)
  assert.notEqual(unknown.errors, '')
  assert.deepEqual(await readdir(root), [])
})

test('lifecycle commands fail open for malformed input without mutating initialized files', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  await initializeProject(root)
  const before = await readFile(join(root, 'AGENTS.md'))

  for (const command of ['session-start', 'prompt', 'stop']) {
    const malformed = await runCliInput([command, '--host', 'codex'], '{')
    const missingCwd = await runCli([command, '--host', 'codex'], { session_id: 'not-required' })
    const invalidObject = await runCliInput([command, '--host', 'codex'], '[]')
    assert.deepEqual(malformed, { code: 0, output: '', errors: '' })
    assert.deepEqual(missingCwd, { code: 0, output: '', errors: '' })
    assert.deepEqual(invalidObject, { code: 0, output: '', errors: '' })
  }

  assert.deepEqual(await readFile(join(root, 'AGENTS.md')), before)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('the exact initialization literal works in every supported event field', async (t) => {
  const fields = ['prompt', 'user_prompt', 'userPrompt', 'message', 'input']
  for (const field of fields) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    const result = await runCli(['prompt', '--host', 'kimi'], { cwd: root, [field]: 'agent-memory:init' })
    const status = await runCli(['status'], { cwd: root })

    assert.equal(result.code, 0)
    assert.equal(result.errors, '')
    assert.match(result.output, /Project memory initialized in AGENTS\.md/)
    assert.deepEqual(JSON.parse(status.output), { initialized: true })
    assertMarkers(await readFile(join(root, 'AGENTS.md'), 'utf8'))
    assert.deepEqual(await readdir(root), ['AGENTS.md'])
  }
})

test('the initialization literal uses structured UserPromptSubmit output for Claude and Codex', async (t) => {
  for (const host of ['claude', 'codex']) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    const result = await runCli(['prompt', '--host', host], { cwd: root, prompt: 'agent-memory:init' })
    const payload = hookOutput(result, 'UserPromptSubmit')

    assert.match(payload.hookSpecificOutput.additionalContext, /Project memory initialized in AGENTS\.md/)
    assert.deepEqual(await readdir(root), ['AGENTS.md'])
  }
})

test('non-exact initialization values do not opt a project in', async (t) => {
  const cases = [
    { prompt: 'AGENT-MEMORY:INIT' },
    { user_prompt: 'Agent-memory:init' },
    { userPrompt: ' agent-memory:init' },
    { message: 'agent-memory:init ' },
    { input: 'please run agent-memory:init' },
    { prompt: 'agent-memory:init now' },
    { prompt: 'ordinary user prompt' }
  ]

  for (const fields of cases) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    const result = await runCli(['prompt', '--host', 'kimi'], { cwd: root, ...fields })
    const status = await runCli(['status'], { cwd: root })

    assert.deepEqual(result, { code: 0, output: '', errors: '' })
    assert.deepEqual(JSON.parse(status.output), { initialized: false })
    assert.deepEqual(await readdir(root), [])
  }
})

test('ordinary lifecycle hooks stay silent and create no files in an uninitialized project', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  const event = { cwd: root, prompt: 'ordinary prompt' }

  for (const host of ['claude', 'codex', 'kimi']) {
    for (const command of ['session-start', 'prompt', 'stop']) {
      const result = await runCli([command, '--host', host], event)
      assert.deepEqual(result, { code: 0, output: '', errors: '' })
    }
  }

  assert.deepEqual(await readdir(root), [])
})

test('an arbitrary AGENTS.md does not opt a project into lifecycle hooks', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  const original = 'Arbitrary project instructions without project-memory markers.\n'
  await writeFile(join(root, 'AGENTS.md'), original, 'utf8')

  for (const host of ['claude', 'codex', 'kimi']) {
    for (const command of ['session-start', 'prompt', 'stop']) {
      const result = await runCli([command, '--host', host], { cwd: root })
      assert.deepEqual(result, { code: 0, output: '', errors: '' })
    }
  }

  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), original)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('ordinary lifecycle hooks preserve AGENTS.md bytes and mtime', async (t) => {
  for (const host of ['claude', 'codex', 'kimi']) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    await initializeProject(root)
    const agentsPath = join(root, 'AGENTS.md')
    const knownTime = new Date('2000-01-02T03:04:05.000Z')
    await utimes(agentsPath, knownTime, knownTime)
    const beforeContent = await readFile(agentsPath)
    const beforeStat = await stat(agentsPath, { bigint: true })

    for (const command of ['session-start', 'prompt', 'stop']) {
      const result = await runCli([command, '--host', host], { cwd: root, prompt: 'ordinary prompt' })
      assert.equal(result.code, 0)
    }

    assert.deepEqual(await readFile(agentsPath), beforeContent)
    assert.equal((await stat(agentsPath, { bigint: true })).mtimeNs, beforeStat.mtimeNs)
  }
})

test('Claude and Codex lifecycle output is structured and always references AGENTS.md', async (t) => {
  for (const host of ['claude', 'codex']) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    await initializeProject(root)

    hookOutput(await runCli(['session-start', '--host', host], { cwd: root }), 'SessionStart')
    const firstPrompt = hookOutput(await runCli(['prompt', '--host', host], { cwd: root, prompt: 'ordinary prompt' }), 'UserPromptSubmit')
    const secondPrompt = hookOutput(await runCli(['prompt', '--host', host], { cwd: root, prompt: 'ordinary prompt' }), 'UserPromptSubmit')

    assert.equal(firstPrompt.hookSpecificOutput.additionalContext, secondPrompt.hookSpecificOutput.additionalContext)
    assert.deepEqual(await readdir(root), ['AGENTS.md'])
  }
})

test('Kimi lifecycle output is plain text and prompts always include the reminder', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  await initializeProject(root)

  const session = await runCli(['session-start', '--host', 'kimi'], { cwd: root })
  const firstPrompt = await runCli(['prompt', '--host', 'kimi'], { cwd: root })
  const secondPrompt = await runCli(['prompt', '--host', 'kimi'], { cwd: root })

  assert.equal(session.code, 0)
  assert.equal(session.errors, '')
  assert.match(session.output, /AGENTS\.md/)
  assert.match(firstPrompt.output, /AGENTS\.md/)
  assert.equal(firstPrompt.output, secondPrompt.output)
  assert.equal(firstPrompt.output.trim().startsWith('{'), false)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('Stop blocks Claude and Codex for initialized projects and avoids the stop hook loop', async (t) => {
  for (const host of ['claude', 'codex']) {
    const root = await temporaryDirectory(t, 'agent-memory-project-')
    await initializeProject(root)

    const stop = await runCli(['stop', '--host', host], { cwd: root })
    const payload = JSON.parse(stop.output)
    assert.equal(stop.code, 0)
    assert.equal(stop.errors, '')
    assert.equal(payload.decision, 'block')
    assert.match(payload.reason, /AGENTS\.md/)

    const active = await runCli(['stop', '--host', host], { cwd: root, stop_hook_active: true })
    assert.deepEqual(active, { code: 0, output: '', errors: '' })
    assert.deepEqual(await readdir(root), ['AGENTS.md'])
  }
})

test('Kimi Stop is silent for initialized projects', async (t) => {
  const root = await temporaryDirectory(t, 'agent-memory-project-')
  await initializeProject(root)

  const result = await runCli(['stop', '--host', 'kimi'], { cwd: root })

  assert.deepEqual(result, { code: 0, output: '', errors: '' })
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('installed cache initializes only its temporary target project', async (t) => {
  const binary = await installedBinary(t)
  const targetRoot = await temporaryDirectory(t, 'agent-memory-target-')
  const result = await runCliAt(binary, targetRoot, ['prompt', '--host', 'kimi'], JSON.stringify({ cwd: targetRoot, input: 'agent-memory:init' }))
  const status = await runCliAt(binary, targetRoot, ['status'], JSON.stringify({ cwd: targetRoot }))

  assert.equal(result.code, 0)
  assert.equal(result.errors, '')
  assert.match(result.output, /Project memory initialized in AGENTS\.md/)
  assert.deepEqual(JSON.parse(status.output), { initialized: true })
  assertMarkers(await readFile(join(targetRoot, 'AGENTS.md'), 'utf8'))
  assert.deepEqual(await readdir(targetRoot), ['AGENTS.md'])
})

test('installed cache preserves existing instructions and arbitrary NOTES.md', async (t) => {
  const binary = await installedBinary(t)
  const targetRoot = await temporaryDirectory(t, 'agent-memory-target-')
  const original = 'Keep these target instructions unchanged.\n'
  const notes = 'Keep this unrelated target note unchanged.\n'
  await writeFile(join(targetRoot, 'AGENTS.md'), original, 'utf8')
  await writeFile(join(targetRoot, 'NOTES.md'), notes, 'utf8')

  const result = await runCliAt(binary, targetRoot, ['init'], JSON.stringify({ cwd: targetRoot }))
  const agents = await readFile(join(targetRoot, 'AGENTS.md'), 'utf8')

  assert.deepEqual(JSON.parse(result.output), { existing: { agents: true }, updated: true })
  assert.equal(agents.startsWith(original), true)
  assert.equal(agents.includes(notes), false)
  assertMarkers(agents)
  assert.equal(await readFile(join(targetRoot, 'NOTES.md'), 'utf8'), notes)
  assert.deepEqual((await readdir(targetRoot)).sort(), ['AGENTS.md', 'NOTES.md'])
})
