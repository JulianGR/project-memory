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
const markers = ['policy:start', 'policy:end', 'state:start', 'state:end'].map((name) => `<!-- project-memory:${name} -->`)
const [policyStart, policyEnd, stateStart, stateEnd] = markers

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

test('initialization creates SPEC.md and AGENTS.md, preserves existing instructions and existing SPEC.md, and never creates .memory', async (t) => {
  for (const original of ['', 'Local instructions that must remain intact.\n']) {
    const root = await temporaryDirectory(t)
    const agentsPath = join(root, 'AGENTS.md')
    const specPath = join(root, 'SPEC.md')
    const customSpec = '# Custom existing spec\nNever overwrite me.\n'
    const readme = '# Public README\nMust never become memory.\n'
    if (original) {
      await writeFile(agentsPath, original)
      await writeFile(specPath, customSpec)
      await writeFile(join(root, 'README.md'), readme)
    }

    assert.deepEqual(await projectStatus(root), {
      active: Boolean(original),
      initialized: false,
      spec: Boolean(original)
    })
    assert.deepEqual(await initializeProject(root), {
      existing: { agents: Boolean(original), spec: Boolean(original) },
      updated: true
    })

    const agentsContent = await readFile(agentsPath)
    const specContent = await readFile(specPath)
    const agentsText = agentsContent.toString()
    assert.equal(agentsText.startsWith(original), true)
    assert.match(agentsText, /SPEC\.md/)
    assert.match(agentsText, /legends\.md/)
    assert.match(agentsText, /\*\*never\*\* use `README\.md`/i)
    assert.doesNotMatch(agentsText, /### Archive index/)
    assertMarkers(agentsText)
    assert.deepEqual(await projectStatus(root), { active: true, initialized: true, spec: true })

    if (original) {
      assert.equal(specContent.toString(), customSpec)
      assert.equal(await readFile(join(root, 'README.md'), 'utf8'), readme)
    } else {
      assert.match(specContent.toString(), /AGENTS\.md/)
    }

    const knownTime = new Date('2000-01-02T03:04:05.000Z')
    await utimes(agentsPath, knownTime, knownTime)
    await utimes(specPath, knownTime, knownTime)
    const beforeAgents = await stat(agentsPath, { bigint: true })
    const beforeSpec = await stat(specPath, { bigint: true })

    assert.deepEqual(await initializeProject(root), {
      existing: { agents: true, spec: true },
      updated: false
    })
    assert.deepEqual(await readFile(agentsPath), agentsContent)
    assert.deepEqual(await readFile(specPath), specContent)
    assert.equal((await stat(agentsPath, { bigint: true })).mtimeNs, beforeAgents.mtimeNs)
    assert.equal((await stat(specPath, { bigint: true })).mtimeNs, beforeSpec.mtimeNs)
    assert.deepEqual((await readdir(root)).sort(), original ? ['AGENTS.md', 'README.md', 'SPEC.md'] : ['AGENTS.md', 'SPEC.md'])
  }
})

test('only unique ordered complete markers identify managed memory; invalid markers are rejected without creating SPEC.md or changing files', async (t) => {
  const root = await temporaryDirectory(t)
  const path = join(root, 'AGENTS.md')
  const readme = 'Keep README untouched.\n'
  assert.equal(await isInitialized(root), false)
  await writeFile(path, 'arbitrary instructions')
  await writeFile(join(root, 'README.md'), readme)
  assert.equal(await isInitialized(root), false)
  await initializeProject(root)
  const valid = await readFile(path, 'utf8')
  await rm(join(root, 'SPEC.md'))
  assert.equal(await isInitialized(root), true)

  const cases = [
    ['duplicate marker', valid.replace(stateEnd, `${stateEnd}\n${stateEnd}`)],
    ['wrong order', `${policyStart}\n${stateStart}\n${policyEnd}\n${stateEnd}\n`],
    ['missing state end', `${policyStart}\n${policyEnd}\n${stateStart}\n`],
    ['unclosed marker tag', `${policyStart}\n${policyEnd}\n<!-- project-memory:state:start\n${stateEnd}\n`],
    ['policy only', `${policyStart}\npartial\n${policyEnd}\n`],
    ['state only', `${stateStart}\npartial\n${stateEnd}\n`],
    ['missing policy end', `${policyStart}\npartial\n${stateStart}\npartial\n${stateEnd}\n`]
  ]
  for (const [label, content] of cases) {
    await writeFile(path, content)
    assert.equal(await isInitialized(root), false, label)
    await assert.rejects(initializeProject(root), /markers/, label)
    assert.equal(await readFile(path, 'utf8'), content, label)
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), readme, label)
    assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md', 'README.md'], label)
  }
})

test('concurrent initialization writes one complete SPEC.md and AGENTS.md pair', async (t) => {
  const root = await temporaryDirectory(t)
  const results = await Promise.all(Array.from({ length: 8 }, () => initializeProject(root)))

  assert.equal(results.filter(({ updated }) => updated).length, 1)
  assert.equal(results.filter(({ existing }) => existing.agents === false && existing.spec === false).length, 1)
  assert.equal(await isInitialized(root), true)
  assertMarkers(await readFile(join(root, 'AGENTS.md'), 'utf8'))
  assert.deepEqual((await readdir(root)).sort(), ['AGENTS.md', 'SPEC.md'])
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
    assert.deepEqual(jsonOutput(await runCli(['status', `--project=${targetRoot}`], options)), {
      active: Boolean(original),
      initialized: false,
      spec: false
    })
    assert.deepEqual(jsonOutput(await runCli(['init', '--project', targetRoot], options)), {
      existing: { agents: Boolean(original), spec: false },
      updated: true
    })
    assert.deepEqual(jsonOutput(await runCli(['status', '--project', targetRoot], options)), {
      active: true,
      initialized: true,
      spec: true
    })

    const agents = await readFile(join(targetRoot, 'AGENTS.md'), 'utf8')
    assertMarkers(agents)
    assert.equal(agents.startsWith(original), true)
    assert.equal(agents.includes(notes), false)
    if (original) assert.equal(await readFile(join(targetRoot, 'NOTES.md'), 'utf8'), notes)
    assert.deepEqual((await readdir(targetRoot)).sort(), original ? ['AGENTS.md', 'NOTES.md', 'SPEC.md'] : ['AGENTS.md', 'SPEC.md'])
  }

  for (const command of ['init', 'status', 'upgrade']) {
    const result = await runCli([command], { cwd: launcherRoot, keepStdinOpen: true })
    assert.equal(result.code, 1, command)
    assert.match(result.errors, /--project/, command)
    assert.equal(result.output, '', command)
  }
  assert.deepEqual(await readdir(launcherRoot), [])
})

test('upgrade updates outdated policy, creates missing SPEC.md, never overwrites existing SPEC.md or state, and stays idempotent', async (t) => {
  const missing = await temporaryDirectory(t)
  assert.deepEqual(await upgradeProject(missing), { existing: { agents: false, initialized: false, spec: false }, updated: false })
  assert.deepEqual(await readdir(missing), [])

  const uninitialized = await temporaryDirectory(t)
  const plainText = 'Custom repo instructions without markers.\n'
  await writeFile(join(uninitialized, 'AGENTS.md'), plainText)
  assert.deepEqual(await upgradeProject(uninitialized), { existing: { agents: true, initialized: false, spec: false }, updated: false })
  assert.equal(await readFile(join(uninitialized, 'AGENTS.md'), 'utf8'), plainText)
  assert.deepEqual(await readdir(uninitialized), ['AGENTS.md'])

  const root = await temporaryDirectory(t)
  const agentsPath = join(root, 'AGENTS.md')
  const specPath = join(root, 'SPEC.md')
  const customPrefix = '# Repo header\nKeep this prefix intact.\n\n'
  const customState = `${stateStart}\n## Project memory\n\n### Custom preserved state\n- Tried X: failed because Y.\n${stateEnd}\n`
  const legacyDoc = `${customPrefix}${policyStart}\n## Old policy\nMove history into .memory/.\n${policyEnd}\n\n${customState}`
  await writeFile(agentsPath, legacyDoc)

  const upgraded = jsonOutput(await runCli(['upgrade', '--project', root], { keepStdinOpen: true }))
  assert.deepEqual(upgraded, { existing: { agents: true, initialized: true, spec: false }, updated: true })

  const after = await readFile(agentsPath, 'utf8')
  assertMarkers(after)
  assert.equal(after.startsWith(customPrefix), true)
  assert.equal(after.endsWith(`\n\n${customState}`), true)
  assert.match(after, /SPEC\.md/)
  assert.match(after, /legends\.md/)
  assert.doesNotMatch(after, /Move history into \.memory\//)
  assert.equal((await readFile(specPath, 'utf8')).includes('Project specification'), true)

  const userSpec = '# Locked goal\n- Objective: Keep everything in SPEC.md + AGENTS.md only.\n'
  await writeFile(specPath, userSpec)
  const knownTime = new Date('2000-01-02T03:04:05.000Z')
  await utimes(agentsPath, knownTime, knownTime)
  await utimes(specPath, knownTime, knownTime)
  const beforeAgentsStat = await stat(agentsPath, { bigint: true })
  const beforeSpecStat = await stat(specPath, { bigint: true })

  assert.deepEqual(await upgradeProject(root), { existing: { agents: true, initialized: true, spec: true }, updated: false })
  assert.equal(await readFile(agentsPath, 'utf8'), after)
  assert.equal(await readFile(specPath, 'utf8'), userSpec)
  assert.equal((await stat(agentsPath, { bigint: true })).mtimeNs, beforeAgentsStat.mtimeNs)
  assert.equal((await stat(specPath, { bigint: true })).mtimeNs, beforeSpecStat.mtimeNs)

  await writeFile(agentsPath, `${customPrefix}${policyStart}\n## Outdated policy\n${policyEnd}\n\n${customState}`)
  assert.deepEqual(await upgradeProject(root), { existing: { agents: true, initialized: true, spec: true }, updated: true })
  assert.equal(await readFile(specPath, 'utf8'), userSpec)
  assert.equal((await stat(specPath, { bigint: true })).mtimeNs, beforeSpecStat.mtimeNs)

  await writeFile(agentsPath, `${policyStart}\nbroken\n`)
  await assert.rejects(upgradeProject(root), /markers/)
})
