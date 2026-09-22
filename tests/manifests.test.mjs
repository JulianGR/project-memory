import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('Claude and Codex manifests use shared Stop discovery with valid runtime and marketplace files', async () => {
  const [binary, library, claude, codex, hooks, claudeMarketplace, codexMarketplace] = await Promise.all([
    readFile(join(projectRoot, 'bin', 'project-memory.mjs'), 'utf8'),
    readFile(join(projectRoot, 'lib', 'project-memory.mjs'), 'utf8'),
    readJson('.claude-plugin/plugin.json'),
    readJson('.codex-plugin/plugin.json'),
    readJson('hooks/hooks.json'),
    readJson('.claude-plugin/marketplace.json'),
    readJson('.agents/plugins/marketplace.json')
  ])

  assert.notEqual(binary.trim(), '')
  assert.notEqual(library.trim(), '')
  assert.equal(claude.name, 'project-memory')
  assert.equal(claude.hooks, undefined)
  assert.equal(codex.name, 'project-memory')
  assert.equal(codex.hooks, undefined)
  assert.deepEqual(Object.keys(hooks.hooks), ['Stop'])
  assert.equal(commandFor(hooks.hooks, 'Stop'), 'node "${CLAUDE_PLUGIN_ROOT}/bin/project-memory.mjs" stop')
  assert.equal(claudeMarketplace.plugins[0].source, './')
  assert.deepEqual(codexMarketplace.plugins[0].source, { source: 'local', path: './' })
  assert.deepEqual(codexMarketplace.plugins[0].policy, { installation: 'AVAILABLE', authentication: 'ON_INSTALL' })
  assert.equal(codexMarketplace.plugins[0].category, 'Productivity')
})

test('Kimi manifest declares exactly its Stop hook', async () => {
  const manifest = await readJson('kimi.plugin.json')
  assert.equal(manifest.name, 'project-memory')
  assert.equal(manifest.skills, './skills/')
  assert.deepEqual(manifest.hooks.map(({ event }) => event), ['Stop'])
  assert.deepEqual(manifest.hooks.map(({ command }) => command), [
    'node ./bin/project-memory.mjs stop --host kimi'
  ])
  assert.ok(manifest.hooks.every(({ timeout }) => Number.isInteger(timeout) && timeout > 0))
})
