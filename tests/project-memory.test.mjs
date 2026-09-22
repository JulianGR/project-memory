import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeProject, isInitialized } from '../lib/project-memory.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = join(projectRoot, 'bin', 'project-memory.mjs')
const markers = ['policy:start', 'policy:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd, stateStart, stateEnd] = markers
const silent = { code: 0, output: '', errors: '' }

async function temporaryDirectory(t, prefix = 'agent-memory-project-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  assert.ok(resolve(root).toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function runCli(args, { binary = cliPath, cwd = projectRoot, event, input, keepStdinOpen = false } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [binary, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let errors = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, 3000)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { errors += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (timedOut) reject(new Error(`CLI timed out: ${args.join(' ')}`))
      else resolveResult({ code, output, errors })
    })
    if (!keepStdinOpen) child.stdin.end(input ?? JSON.stringify(event))
  })
}

function jsonOutput(result, label) {
  assert.equal(result.code, 0, label || result.errors)
  assert.equal(result.errors, '', label)
  return JSON.parse(result.output)
}

function assertMarkers(content) {
  for (const marker of markers) assert.equal(content.split(marker).length - 1, 1, marker)
  const positions = markers.map((marker) => content.indexOf(marker))
  assert.deepEqual([...positions].sort((first, second) => first - second), positions)
}

function assertStop(result, host, label) {
  const payload = jsonOutput(result, label)
  const reason = payload.reason ?? payload.hookSpecificOutput?.additionalContext ?? payload.hookSpecificOutput?.permissionDecisionReason
  assert.equal(typeof reason, 'string', label)
  assert.match(reason, /AGENTS\.md/, label)
  const expected = {
    codex: { decision: 'block', reason },
    claude: { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason } },
    kimi: { hookSpecificOutput: { hookEventName: 'Stop', permissionDecision: 'deny', permissionDecisionReason: reason } }
  }
  assert.deepEqual(payload, expected[host], label)
}

async function installedBinary(t) {
  const cacheRoot = await temporaryDirectory(t, 'agent-memory-cache-')
  const installedRoot = join(cacheRoot, 'project-memory')
  await mkdir(installedRoot)
  await Promise.all(['bin', 'lib', 'templates'].map((directory) => cp(join(projectRoot, directory), join(installedRoot, directory), { recursive: true })))
  return join(installedRoot, 'bin', 'project-memory.mjs')
}

test('initialization creates or preserves AGENTS.md and repeated initialization changes neither bytes nor mtime', async (t) => {
  for (const original of ['', 'Local instructions that must remain intact.\n']) {
    const root = await temporaryDirectory(t)
    const path = join(root, 'AGENTS.md')
    const notes = 'This unrelated file must not become project memory.\n'
    if (original) {
      await writeFile(path, original)
      await writeFile(join(root, 'NOTES.md'), notes)
    }

    assert.deepEqual(await initializeProject(root), { existing: { agents: Boolean(original) }, updated: true })
    const content = await readFile(path)
    const agents = content.toString()
    assert.equal(agents.startsWith(original), true)
    assert.equal(agents.includes(notes), false)
    assertMarkers(agents)
    if (original) assert.equal(await readFile(join(root, 'NOTES.md'), 'utf8'), notes)

    const knownTime = new Date('2000-01-02T03:04:05.000Z')
    await utimes(path, knownTime, knownTime)
    const before = await stat(path, { bigint: true })
    assert.deepEqual(await initializeProject(root), { existing: { agents: true }, updated: false })
    assert.deepEqual(await readFile(path), content)
    assert.equal((await stat(path, { bigint: true })).mtimeNs, before.mtimeNs)
    assert.deepEqual((await readdir(root)).sort(), original ? ['AGENTS.md', 'NOTES.md'] : ['AGENTS.md'])
  }
})

test('only unique ordered complete markers activate memory; invalid markers are rejected without changing files', async (t) => {
  const root = await temporaryDirectory(t)
  const path = join(root, 'AGENTS.md')
  const notes = 'Keep this unrelated file unchanged.\n'
  assert.equal(await isInitialized(root), false)
  await writeFile(path, 'arbitrary instructions')
  await writeFile(join(root, 'NOTES.md'), notes)
  assert.equal(await isInitialized(root), false)
  await initializeProject(root)
  const valid = await readFile(path, 'utf8')
  assert.equal(await isInitialized(root), true)

  const cases = [
    ['duplicate marker', valid.replace(stateEnd, `${stateEnd}\n${stateEnd}`)],
    ['wrong order', `${policyStart}\n${stateStart}\n${policyEnd}\n${stateEnd}\n`],
    ['missing state end', `${policyStart}\n${policyEnd}\n${stateStart}\n`],
    ['policy only', `${policyStart}\npartial\n${policyEnd}\n`],
    ['state only', `${stateStart}\npartial\n${stateEnd}\n`],
    ['missing policy end', `${policyStart}\npartial\n${stateStart}\npartial\n${stateEnd}\n`]
  ]
  for (const [label, content] of cases) {
    await writeFile(path, content)
    assert.equal(await isInitialized(root), false, label)
    await assert.rejects(initializeProject(root), /markers/, label)
    assert.equal(await readFile(path, 'utf8'), content, label)
    assert.equal(await readFile(join(root, 'NOTES.md'), 'utf8'), notes, label)
    assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md', 'NOTES.md'], label)
  }
})

test('concurrent initialization writes one complete AGENTS.md document', async (t) => {
  const root = await temporaryDirectory(t)
  const results = await Promise.all(Array.from({ length: 8 }, () => initializeProject(root)))

  assert.equal(results.filter(({ updated }) => updated).length, 1)
  assert.equal(results.filter(({ existing }) => existing.agents === false).length, 1)
  for (const result of results) assert.deepEqual(Object.keys(result).sort(), ['existing', 'updated'])
  assert.equal(await isInitialized(root), true)
  assertMarkers(await readFile(join(root, 'AGENTS.md'), 'utf8'))
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
})

test('source and installed CLI require explicit targets, preserve files, and finish with stdin open from another cwd', async (t) => {
  const launcherRoot = await temporaryDirectory(t, 'agent-memory-launcher-')
  const cachedBinary = await installedBinary(t)
  const cases = [
    { binary: cliPath, original: '' },
    { binary: cachedBinary, original: 'Keep these target instructions unchanged.\n' }
  ]
  for (const { binary, original } of cases) {
    const targetRoot = await temporaryDirectory(t, 'agent-memory-target-')
    const notes = 'Keep this unrelated target note unchanged.\n'
    if (original) {
      await writeFile(join(targetRoot, 'AGENTS.md'), original)
      await writeFile(join(targetRoot, 'NOTES.md'), notes)
    }
    const options = { binary, cwd: launcherRoot, keepStdinOpen: true }
    assert.deepEqual(jsonOutput(await runCli(['status', `--project=${targetRoot}`], options)), { initialized: false })
    assert.deepEqual(jsonOutput(await runCli(['init', '--project', targetRoot], options)), { existing: { agents: Boolean(original) }, updated: true })
    assert.deepEqual(jsonOutput(await runCli(['status', '--project', targetRoot], options)), { initialized: true })

    const agents = await readFile(join(targetRoot, 'AGENTS.md'), 'utf8')
    assertMarkers(agents)
    assert.equal(agents.startsWith(original), true)
    assert.equal(agents.includes(notes), false)
    if (original) assert.equal(await readFile(join(targetRoot, 'NOTES.md'), 'utf8'), notes)
    assert.deepEqual((await readdir(targetRoot)).sort(), original ? ['AGENTS.md', 'NOTES.md'] : ['AGENTS.md'])
  }

  for (const command of ['init', 'status']) {
    const result = await runCli([command], { cwd: launcherRoot, keepStdinOpen: true })
    assert.equal(result.code, 1, command)
    assert.match(result.errors, /--project/, command)
    assert.equal(result.output, '', command)
  }
  assert.deepEqual(await readdir(launcherRoot), [])
})

test('Stop detects hosts and honors overrides with the exact Claude, Codex, and Kimi payloads', async (t) => {
  const root = await temporaryDirectory(t)
  await initializeProject(root)
  const cases = [
    ['auto Codex', 'codex', [], { turn_id: 'turn-1' }],
    ['auto Claude', 'claude', [], {}],
    ['empty turn id', 'claude', [], { turn_id: '' }],
    ['invalid turn id', 'claude', [], { turn_id: 42 }],
    ['explicit Codex', 'codex', ['--host', 'codex'], {}],
    ['explicit Claude', 'claude', ['--host', 'claude'], { turn_id: 'turn-1' }],
    ['explicit Kimi', 'kimi', ['--host', 'kimi'], {}]
  ]
  const before = await readFile(join(root, 'AGENTS.md'))
  for (const [label, host, args, event] of cases) {
    assertStop(await runCli(['stop', ...args], { event: { cwd: root, ...event } }), host, label)
  }
  assert.deepEqual(await readFile(join(root, 'AGENTS.md')), before)
})

test('Stop silently ignores invalid events, unknown hosts, and uninitialized projects without writing', async (t) => {
  const root = await temporaryDirectory(t)
  const uninitialized = await temporaryDirectory(t)
  await initializeProject(root)
  const before = await readFile(join(root, 'AGENTS.md'))
  const cases = [
    { label: 'malformed JSON', input: '{' },
    { label: 'invalid event object', input: '[]' },
    { label: 'missing cwd', event: {} },
    { label: 'empty cwd', event: { cwd: '' } },
    { label: 'unknown host', args: ['stop', '--host', 'unknown'], event: { cwd: root } },
    { label: 'uninitialized project', event: { cwd: uninitialized, turn_id: 'turn-1' } }
  ]
  for (const { label, args = ['stop'], ...options } of cases) {
    assert.deepEqual(await runCli(args, options), silent, label)
  }
  assert.deepEqual(await readFile(join(root, 'AGENTS.md')), before)
  assert.deepEqual(await readdir(root), ['AGENTS.md'])
  assert.deepEqual(await readdir(uninitialized), [])
})

test('Stop guards prevent nested reviews and fail open for invalid guard values', async (t) => {
  const root = await temporaryDirectory(t)
  await initializeProject(root)
  for (const host of ['codex', 'kimi']) {
    const args = host === 'codex' ? ['stop'] : ['stop', '--host', host]
    for (const active of [true, 'true', 0, null, []]) {
      const event = { cwd: root, turn_id: 'turn-1', stop_hook_active: active }
      assert.deepEqual(await runCli(args, { event }), silent, `${host}: ${JSON.stringify(active)}`)
    }
    for (const active of [false, undefined]) {
      const event = { cwd: root, turn_id: 'turn-1', stop_hook_active: active }
      assertStop(await runCli(args, { event }), host, `${host}: ${active}`)
    }
  }
})
