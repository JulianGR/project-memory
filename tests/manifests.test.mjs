import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function readJson(path) {
  return JSON.parse(await readFile(join(projectRoot, path), 'utf8'))
}

function commandFor(hooks, event) {
  assert.equal(hooks[event].length, 1)
  assert.equal(hooks[event][0].hooks.length, 1)
  return hooks[event][0].hooks[0].command
}

test('installed root provides the Node runtime and every host manifest', async () => {
  await Promise.all([
    access(join(projectRoot, 'bin', 'project-memory.mjs')),
    access(join(projectRoot, 'lib', 'project-memory.mjs')),
    access(join(projectRoot, '.claude-plugin', 'plugin.json')),
    access(join(projectRoot, '.codex-plugin', 'plugin.json')),
    access(join(projectRoot, '.agents', 'plugins', 'marketplace.json')),
    access(join(projectRoot, 'hooks', 'hooks.json')),
    access(join(projectRoot, 'kimi.plugin.json'))
  ])
})

test('Claude marketplace installs the repository root', async () => {
  const marketplace = await readJson('.claude-plugin/marketplace.json')
  assert.equal(marketplace.plugins[0].source, './')
})

test('Claude manifest registers SessionStart, UserPromptSubmit, and Stop hooks', async () => {
  const manifest = await readJson('.claude-plugin/plugin.json')
  assert.equal(manifest.name, 'project-memory')
  assert.equal(commandFor(manifest.hooks, 'SessionStart'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" session-start --host claude')
  assert.equal(commandFor(manifest.hooks, 'UserPromptSubmit'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" prompt --host claude')
  assert.equal(commandFor(manifest.hooks, 'Stop'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" stop --host claude')
})

test('Codex manifest exposes SessionStart, UserPromptSubmit, and Stop hooks through default discovery', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json')
  const hooks = await readJson('hooks/hooks.json')
  assert.equal(manifest.name, 'project-memory')
  assert.equal(manifest.hooks, undefined)
  assert.equal(commandFor(hooks.hooks, 'SessionStart'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" session-start --host codex')
  assert.equal(commandFor(hooks.hooks, 'UserPromptSubmit'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" prompt --host codex')
  assert.equal(commandFor(hooks.hooks, 'Stop'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" stop --host codex')
})

test('Kimi manifest declares exactly the existing two lifecycle hooks without Stop', async () => {
  const manifest = await readJson('kimi.plugin.json')
  assert.equal(manifest.skills, './skills/')
  assert.deepEqual(manifest.hooks.map(({ event }) => event), ['SessionStart', 'UserPromptSubmit'])
  assert.deepEqual(manifest.hooks.map(({ command }) => command), [
    'node ./bin/project-memory.mjs session-start --host kimi',
    'node ./bin/project-memory.mjs prompt --host kimi'
  ])
  assert.equal(manifest.hooks.some(({ event }) => event === 'Stop'), false)
  assert.ok(manifest.hooks.every(({ timeout }) => Number.isInteger(timeout) && timeout > 0))
})

test('Codex marketplace installs the repository root with policy metadata', async () => {
  const marketplace = await readJson('.agents/plugins/marketplace.json')
  const plugin = marketplace.plugins[0]
  assert.deepEqual(plugin.source, { source: 'local', path: './' })
  assert.deepEqual(plugin.policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' })
  assert.equal(plugin.category, 'Productivity')
})
