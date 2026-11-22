import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeProject, isInitialized, projectStatus, upgradeProject } from '../scripts/project-memory.mjs'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const cliPath = join(projectRoot, 'scripts', 'project-memory.mjs')
const markers = ['policy:start', 'policy:end', 'goal:start', 'goal:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd, goalStart, goalEnd, stateStart, stateEnd] = markers

async function temporaryDirectory(t, prefix = 'project-memory-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  assert.ok(resolve(root).toLowerCase().startsWith(`${resolve(tmpdir())}${sep}`.toLowerCase()))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function runCli(args, { binary = cliPath, cwd = projectRoot, keepStdinOpen = false } = {}) {
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
    if (!keepStdinOpen) child.stdin.end()
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

async function copiedSkillBinary(t) {
  const cacheRoot = await temporaryDirectory(t, 'project-memory-skill-')
  const installedRoot = join(cacheRoot, 'project-memory')
  await mkdir(installedRoot)
  await Promise.all(['scripts', 'templates'].map((directory) => cp(join(projectRoot, directory), join(installedRoot, directory), { recursive: true })))
  return join(installedRoot, 'scripts', 'project-memory.mjs')
}

test('initialization creates or preserves AGENTS.md with policy, goal, and state blocks and repeated initialization changes neither bytes nor mtime', async (t) => {
  for (const original of ['', 'Local instructions that must remain intact.\n']) {
    const root = await temporaryDirectory(t)
    const path = join(root, 'AGENTS.md')
    const notes = 'This unrelated file must not become project memory.\n'
    if (original) {
      await writeFile(path, original)
      await writeFile(join(root, 'NOTES.md'), notes)
    }

    assert.deepEqual(await projectStatus(root), { active: Boolean(original), initialized: false })
    assert.deepEqual(await initializeProject(root), { existing: { agents: Boolean(original) }, updated: true })
    const content = await readFile(path)
    const agents = content.toString()
    assert.equal(agents.startsWith(original), true)
    assert.equal(agents.includes(notes), false)
    assertMarkers(agents)
    assert.deepEqual(await projectStatus(root), { active: true, initialized: true })
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

test('only unique ordered complete markers identify managed memory; invalid markers are rejected without changing files', async (t) => {
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
    ['duplicate goal marker', valid.replace(goalEnd, `${goalEnd}\n${goalEnd}`)],
    ['wrong order state before policy end', `${policyStart}\n${stateStart}\n${policyEnd}\n${stateEnd}\n`],
    ['wrong order goal after state', `${policyStart}\n${policyEnd}\n${stateStart}\n${stateEnd}\n${goalStart}\n${goalEnd}\n`],
    ['missing state end', `${policyStart}\n${policyEnd}\n${goalStart}\n${goalEnd}\n${stateStart}\n`],
    ['missing goal end', `${policyStart}\n${policyEnd}\n${goalStart}\n${stateStart}\n${stateEnd}\n`],
    ['unclosed marker tag', `${policyStart}\n${policyEnd}\n<!-- project-memory:goal:start\n${stateStart}\n${stateEnd}\n`],
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

test('CLI init and status require explicit --project, preserve files, and finish with stdin open from another cwd', async (t) => {
  const launcherRoot = await temporaryDirectory(t, 'project-memory-launcher-')
  const standaloneBinary = await copiedSkillBinary(t)
  const cases = [
    { binary: cliPath, original: '' },
    { binary: standaloneBinary, original: 'Keep these target instructions unchanged.\n' }
  ]
  for (const { binary, original } of cases) {
    const targetRoot = await temporaryDirectory(t, 'project-memory-target-')
    const notes = 'Keep this unrelated target note unchanged.\n'
    if (original) {
      await writeFile(join(targetRoot, 'AGENTS.md'), original)
      await writeFile(join(targetRoot, 'NOTES.md'), notes)
    }
    const options = { binary, cwd: launcherRoot, keepStdinOpen: true }
    assert.deepEqual(jsonOutput(await runCli(['status', `--project=${targetRoot}`], options)), { active: Boolean(original), initialized: false })
    assert.deepEqual(jsonOutput(await runCli(['init', '--project', targetRoot], options)), { existing: { agents: Boolean(original) }, updated: true })
    assert.deepEqual(jsonOutput(await runCli(['status', '--project', targetRoot], options)), { active: true, initialized: true })

    const agents = await readFile(join(targetRoot, 'AGENTS.md'), 'utf8')
    assertMarkers(agents)
    assert.equal(agents.startsWith(original), true)
    assert.equal(agents.includes(notes), false)
    if (original) assert.equal(await readFile(join(targetRoot, 'NOTES.md'), 'utf8'), notes)
    assert.deepEqual((await readdir(targetRoot)).sort(), original ? ['AGENTS.md', 'NOTES.md'] : ['AGENTS.md'])
  }

  for (const command of ['init', 'status', 'upgrade']) {
    const result = await runCli([command], { cwd: launcherRoot, keepStdinOpen: true })
    assert.equal(result.code, 1, command)
    assert.match(result.errors, /--project/, command)
    assert.equal(result.output, '', command)
  }
  assert.deepEqual(await readdir(launcherRoot), [])
})

test('upgrade migrates legacy 4-marker docs to include goal block and preserves user goal, custom instructions, state, and idempotence', async (t) => {
  const missing = await temporaryDirectory(t)
  assert.deepEqual(await upgradeProject(missing), { existing: { agents: false, initialized: false }, updated: false })
  assert.deepEqual(await readdir(missing), [])

  const uninitialized = await temporaryDirectory(t)
  const plainText = 'Custom repo instructions without markers.\n'
  await writeFile(join(uninitialized, 'AGENTS.md'), plainText)
  assert.deepEqual(await upgradeProject(uninitialized), { existing: { agents: true, initialized: false }, updated: false })
  assert.equal(await readFile(join(uninitialized, 'AGENTS.md'), 'utf8'), plainText)

  const root = await temporaryDirectory(t)
  const path = join(root, 'AGENTS.md')
  const customPrefix = '# Repo header\nKeep this prefix intact.\n\n'
  const customState = `${stateStart}\n## Project memory\n\n### Custom preserved state\n- Tried X: failed because Y.\n${stateEnd}\n`
  const legacyDoc = `${customPrefix}${policyStart}\n## Old policy\nDo not create a second memory file.\n${policyEnd}\n\n${customState}`
  await writeFile(path, legacyDoc)
  assert.equal(await isInitialized(root), true)

  const upgraded = jsonOutput(await runCli(['upgrade', '--project', root], { keepStdinOpen: true }))
  assert.deepEqual(upgraded, { existing: { agents: true, initialized: true }, updated: true })

  const after = await readFile(path, 'utf8')
  assertMarkers(after)
  assert.equal(after.startsWith(customPrefix), true)
  assert.equal(after.endsWith(`\n\n${customState}`), true)
  assert.match(after, /\.memory\//)
  assert.match(after, /Protected goal/)
  assert.doesNotMatch(after, /Do not create a second memory file/)

  const knownTime = new Date('2000-01-02T03:04:05.000Z')
  await utimes(path, knownTime, knownTime)
  const beforeStat = await stat(path, { bigint: true })
  assert.deepEqual(await upgradeProject(root), { existing: { agents: true, initialized: true }, updated: false })
  assert.equal(await readFile(path, 'utf8'), after)
  assert.equal((await stat(path, { bigint: true })).mtimeNs, beforeStat.mtimeNs)

  const customGoal = `${goalStart}\n## Project goal\n- **Objective**: Ship zero-dependency CLI.\n- **Out of scope / limits**: No servers or SQLite.\n- **Done criteria**: All node:test suites pass.\n${goalEnd}`
  const withUserGoal = `${customPrefix}${policyStart}\n## Outdated v1.1 policy\n${policyEnd}\n\n${customGoal}\n\n${customState}`
  await writeFile(path, withUserGoal)
  assert.deepEqual(await upgradeProject(root), { existing: { agents: true, initialized: true }, updated: true })
  const afterGoalPreserved = await readFile(path, 'utf8')
  assertMarkers(afterGoalPreserved)
  assert.equal(afterGoalPreserved.includes(customGoal), true)
  assert.equal(afterGoalPreserved.endsWith(`\n\n${customState}`), true)
  assert.doesNotMatch(afterGoalPreserved, /Outdated v1\.1 policy/)

  await writeFile(path, `${policyStart}\nbroken\n`)
  await assert.rejects(upgradeProject(root), /markers/)
})
