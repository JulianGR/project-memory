# Cross-agent memory and compaction implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project memory and compaction warnings work in Claude Code Desktop, Codex Desktop, and Kimi Code CLI on Windows, macOS, and Linux.

**Architecture:** Each repository gets a dependency-free Node.js core and thin host-specific plugin manifests. `auto-update-claude-md` owns the `STATUS.md` protocol and opt-in initialization. `compaction-watch` owns session-scoped counters and alerts. Native host hooks call the same Node commands with host and event metadata.

**Tech Stack:** Node.js 20+, `node:test`, Node standard library, JSON plugin manifests, Kimi plugin manifest, Claude hooks, Codex hooks.

## Global Constraints

- Support Windows, macOS, and Linux without requiring Bash, `jq`, or external Node packages.
- Treat `STATUS.md` as opt-in project memory; do not create it automatically in arbitrary directories.
- Generate `AGENTS.md` and `CLAUDE.md` from one template so their bytes are identical.
- Keep host state outside Git and store no prompts, transcripts, code, or secrets.
- Fail open: a broken hook must not block a coding session or compaction.
- Default the memory reminder to 4 prompts, the compaction soft warning to 5, and the strong warning to 10.
- Mark Kimi VS Code panel support as experimental until a real extension run verifies hook delivery.
- Preserve existing Claude plugin behavior where it does not conflict with this design.

---

## File structure

### `auto-update-claude-md`

| File | Responsibility |
| --- | --- |
| `package.json` | Defines the dependency-free Node test command. |
| `lib/project-memory.mjs` | Project initialization, state paths, cadence, prompt text, and host output. |
| `bin/project-memory.mjs` | CLI and hook entry point. |
| `templates/STATUS.md` | Initial project-memory structure. |
| `templates/AGENT-INSTRUCTIONS.md` | Canonical identical content for `AGENTS.md` and `CLAUDE.md`. |
| `plugins/auto-update-claude-md/hooks/hooks.json` | Claude hook adapter. |
| `.codex-plugin/plugin.json` and `hooks/hooks.json` | Codex plugin and hook adapter. |
| `kimi.plugin.json` | Kimi plugin and hook adapter. |
| `tests/project-memory.test.mjs` | Unit and integration tests for initialization and cadence. |
| `README.md` | Host support, installation, initialization, and limitations. |

### `compaction-watch`

| File | Responsibility |
| --- | --- |
| `package.json` | Defines the dependency-free Node test command. |
| `lib/compaction-watch.mjs` | Counter state, thresholds, event normalization, warnings, and native notification selection. |
| `bin/compaction-watch.mjs` | CLI and hook entry point. |
| `plugins/compaction-watch/hooks/hooks.json` | Claude hook adapter. |
| `.codex-plugin/plugin.json` and `hooks/hooks.json` | Codex plugin and hook adapter. |
| `kimi.plugin.json` | Kimi plugin and hook adapter. |
| `tests/compaction-watch.test.mjs` | Unit and integration tests for counters and warning transitions. |
| `README.md` | Host support, installation, thresholds, and GUI limitations. |

## Task 1: Build the opt-in project-memory core

**Files:**

- Create: `auto-update-claude-md/package.json`
- Create: `auto-update-claude-md/lib/project-memory.mjs`
- Create: `auto-update-claude-md/bin/project-memory.mjs`
- Create: `auto-update-claude-md/templates/STATUS.md`
- Create: `auto-update-claude-md/templates/AGENT-INSTRUCTIONS.md`
- Create: `auto-update-claude-md/tests/project-memory.test.mjs`

**Interfaces:**

- Consumes: hook JSON with `cwd`, `session_id`, and optionally `hook_event_name`.
- Produces: `initializeProject(root)`, `isInitialized(root)`, `recordPrompt(event)`, `formatReminder(host, state)`, and the commands `init`, `session-start`, `prompt`, and `status`.

- [ ] **Step 1: Write failing initialization tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initializeProject } from '../lib/project-memory.mjs'

test('initializeProject creates STATUS.md and identical pointer files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-memory-'))
  await initializeProject(root)
  const agents = await readFile(join(root, 'AGENTS.md'), 'utf8')
  const claude = await readFile(join(root, 'CLAUDE.md'), 'utf8')
  const status = await readFile(join(root, 'STATUS.md'), 'utf8')
  assert.equal(agents, claude)
  assert.match(status, /## Current state/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/project-memory.test.mjs`

Expected: FAIL because `../lib/project-memory.mjs` does not exist.

- [ ] **Step 3: Add templates and the minimal initializer**

```js
export async function initializeProject(root) {
  const instructions = await readFile(templatePath('AGENT-INSTRUCTIONS.md'), 'utf8')
  await writeFile(join(root, 'AGENTS.md'), instructions, { flag: 'wx' })
  await writeFile(join(root, 'CLAUDE.md'), instructions, { flag: 'wx' })
  await copyFile(templatePath('STATUS.md'), join(root, 'STATUS.md'), COPYFILE_EXCL)
}
```

The implementation must leave existing `STATUS.md`, `AGENTS.md`, and `CLAUDE.md` unchanged, return their presence in a result object, and use UTF-8.

- [ ] **Step 4: Run the initialization tests and verify they pass**

Run: `node --test tests/project-memory.test.mjs`

Expected: PASS.

- [ ] **Step 5: Add cadence and host-output failing tests**

```js
test('recordPrompt emits a reminder only at the configured interval', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-memory-state-'))
  const event = { cwd: '/repo', session_id: 's1' }
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, false)
  assert.equal((await recordPrompt({ host: 'claude', event, stateRoot, interval: 4 })).due, true)
})

test('formatReminder uses Codex system-message JSON', () => {
  const output = formatReminder('codex', { count: 4, interval: 4 })
  assert.deepEqual(JSON.parse(output), { systemMessage: 'Project memory checkpoint due: update STATUS.md if durable work changed.' })
})
```

- [ ] **Step 6: Implement deterministic state and the command runner**

```js
export async function recordPrompt({ host, event, stateRoot, interval }) {
  const key = createHash('sha256').update(`${host}\0${event.cwd}\0${event.session_id}`).digest('hex')
  const count = await incrementCounter(join(stateRoot, `${key}.json`))
  return { count, due: count % interval === 0, interval }
}

const commands = new Map([
  ['init', initializeCommand],
  ['session-start', sessionStartCommand],
  ['prompt', promptCommand],
  ['status', statusCommand]
])
```

Use `AGENT_MEMORY_HOME` as an override and otherwise store state under the OS home directory. Accept `AGENT_MEMORY_INTERVAL`, then `AUTO_UPDATE_CLAUDE_N` for backward compatibility, then default to `4`.

- [ ] **Step 7: Run the complete memory test suite**

Run: `node --test tests/project-memory.test.mjs`

Expected: PASS, including idempotency, uninitialized-project silence, per-session isolation, default interval, legacy interval, Claude text output, Kimi text output, and Codex JSON output.

- [ ] **Step 8: Commit the project-memory core**

```bash
git add package.json lib/project-memory.mjs bin/project-memory.mjs templates tests/project-memory.test.mjs
git commit -m "feat: add project memory core"
```

## Task 2: Package project-memory for Claude, Codex, and Kimi

**Files:**

- Modify: `auto-update-claude-md/.claude-plugin/marketplace.json`
- Create: `auto-update-claude-md/.claude-plugin/plugin.json`
- Create: `auto-update-claude-md/.codex-plugin/plugin.json`
- Create: `auto-update-claude-md/hooks/hooks.json`
- Create: `auto-update-claude-md/skills/auto-update-claude-md/SKILL.md`
- Create: `auto-update-claude-md/kimi.plugin.json`
- Create: `auto-update-claude-md/.agents/plugins/marketplace.json`
- Modify: `auto-update-claude-md/README.md`
- Create: `auto-update-claude-md/tests/manifests.test.mjs`
- Delete: `auto-update-claude-md/plugins/auto-update-claude-md/`
- Delete: `auto-update-claude-md/install.sh`

**Interfaces:**

- Consumes: the `bin/project-memory.mjs` commands from Task 1.
- Produces: valid host manifests with `SessionStart` and `UserPromptSubmit` hooks.

- [ ] **Step 1: Write manifest tests before adding manifests**

```js
test('Codex manifest exposes project-memory hooks', async () => {
  const manifest = JSON.parse(await readFile('.codex-plugin/plugin.json', 'utf8'))
  assert.equal(manifest.name, 'auto-update-claude-md')
  await access('hooks/hooks.json')
})

test('Kimi manifest declares session and prompt hooks', async () => {
  const manifest = JSON.parse(await readFile('kimi.plugin.json', 'utf8'))
  assert.deepEqual(manifest.hooks.map(({ event }) => event), ['SessionStart', 'UserPromptSubmit'])
})
```

- [ ] **Step 2: Run manifest tests and verify they fail**

Run: `node --test tests/manifests.test.mjs`

Expected: FAIL because Codex and Kimi manifests are absent.

- [ ] **Step 3: Add thin adapters**

The repository root is the plugin root for all three hosts. Both marketplace entries use `"source": "./"`; this is necessary so the installed plugin includes the Node core. Use these commands in every adapter:

```json
{
  "type": "command",
  "command": "node \"${PLUGIN_ROOT}/bin/project-memory.mjs\" prompt --host codex"
}
```

The Claude adapter uses `CLAUDE_PLUGIN_ROOT`; Codex accepts the same compatibility variable; the Kimi adapter uses `node ./bin/project-memory.mjs prompt --host kimi`. `SessionStart` calls `session-start` and `UserPromptSubmit` calls `prompt`. The Codex manifest leaves out its optional `hooks` field and relies on the default `hooks/hooks.json` discovery.

- [ ] **Step 4: Update the skill and README**

Document:

- `node bin/project-memory.mjs init` initializes a serious project.
- The pointers are intentionally identical and `STATUS.md` is not a transcript.
- Claude and Kimi receive cadence context.
- Codex receives a visible checkpoint and relies on `AGENTS.md` for the semantic update rule.
- Kimi VS Code support is experimental.

- [ ] **Step 5: Run all auto-update tests**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the host packages**

```bash
git add .claude-plugin .codex-plugin .agents hooks skills kimi.plugin.json README.md tests
git rm -r plugins install.sh
git commit -m "feat: support Codex and Kimi project memory"
```

## Task 3: Build the cross-platform compaction-watch core

**Files:**

- Create: `compaction-watch/package.json`
- Create: `compaction-watch/lib/compaction-watch.mjs`
- Create: `compaction-watch/bin/compaction-watch.mjs`
- Create: `compaction-watch/tests/compaction-watch.test.mjs`

**Interfaces:**

- Consumes: hook JSON with `session_id`, `cwd`, and `trigger`.
- Produces: `recordCompaction`, `readStatus`, `formatWarning`, `notificationCommand`, and CLI commands `count`, `notify`, `status`, and `prune`.

- [ ] **Step 1: Write failing counter and threshold tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordCompaction, formatWarning } from '../lib/compaction-watch.mjs'

test('recordCompaction isolates sessions and reports the fifth compaction', async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), 'compaction-watch-'))
  const event = { cwd: '/repo', session_id: 's1', trigger: 'auto' }
  for (let index = 0; index < 4; index += 1) await recordCompaction({ host: 'codex', event, stateRoot })
  const result = await recordCompaction({ host: 'codex', event, stateRoot })
  assert.equal(result.count, 5)
  assert.equal(result.level, 'soft')
  assert.match(formatWarning(result), /5 compactions/)
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test tests/compaction-watch.test.mjs`

Expected: FAIL because `../lib/compaction-watch.mjs` does not exist.

- [ ] **Step 3: Implement the Node core**

```js
export async function recordCompaction({ host, event, stateRoot, thresholds = { soft: 5, strong: 10 } }) {
  const stateFile = stateFileFor({ host, cwd: event.cwd, sessionId: event.session_id, stateRoot })
  const current = await readJson(stateFile, { count: 0, triggers: [] })
  const count = current.count + 1
  const level = count >= thresholds.strong ? 'strong' : count >= thresholds.soft ? 'soft' : 'none'
  await writeJsonAtomic(stateFile, { count, triggers: [...current.triggers, event.trigger ?? 'auto'], updatedAt: new Date().toISOString() })
  return { count, level, host, trigger: event.trigger ?? 'auto', thresholds }
}
```

Store state under `AGENT_COMPACTION_WATCH_HOME` when set and otherwise under the user home directory. Hash normalized project paths and preserve session ids only in local state filenames.

- [ ] **Step 4: Add failing notification-selection tests**

```js
test('notificationCommand chooses Windows PowerShell', () => {
  const command = notificationCommand('win32', 'Compaction watch', '5 compactations')
  assert.equal(command.command, 'powershell.exe')
  assert.match(command.args.join(' '), /Compaction watch/)
})

test('notificationCommand is optional on unsupported platforms', () => {
  assert.equal(notificationCommand('freebsd', 'title', 'body'), null)
})
```

- [ ] **Step 5: Implement best-effort native notifications and CLI output**

```js
export function notificationCommand(platform, title, body) {
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', powershellToast(title, body)] }
  if (platform === 'darwin') return { command: 'osascript', args: ['-e', `display notification ${quoteApple(body)} with title ${quoteApple(title)}`] }
  if (platform === 'linux') return { command: 'notify-send', args: [title, body] }
  return null
}
```

Spawn notification commands with ignored output and catch every error. Notify only when the counter first reaches a threshold. Use host-specific output: plain text for Claude and Kimi, `{ "systemMessage": "..." }` for Codex.

- [ ] **Step 6: Run the complete compaction core test suite**

Run: `node --test tests/compaction-watch.test.mjs`

Expected: PASS for auto-only behavior, manual triggers, state isolation, corrupt state recovery, thresholds, repeat cadence, and all notification command selectors.

- [ ] **Step 7: Commit the compaction core**

```bash
git add package.json lib/compaction-watch.mjs bin/compaction-watch.mjs tests/compaction-watch.test.mjs
git commit -m "feat: add cross-platform compaction core"
```

## Task 4: Package compaction-watch for Claude, Codex, and Kimi

**Files:**

- Modify: `compaction-watch/.claude-plugin/marketplace.json`
- Create: `compaction-watch/.claude-plugin/plugin.json`
- Create: `compaction-watch/.codex-plugin/plugin.json`
- Create: `compaction-watch/hooks/hooks.json`
- Create: `compaction-watch/skills/compaction-watch/SKILL.md`
- Create: `compaction-watch/kimi.plugin.json`
- Create: `compaction-watch/.agents/plugins/marketplace.json`
- Create: `compaction-watch/tests/manifests.test.mjs`
- Modify: `compaction-watch/README.md`
- Delete: `compaction-watch/plugins/compaction-watch/`
- Delete: `compaction-watch/install.sh`

**Interfaces:**

- Consumes: Task 3 `count`, `notify`, `status`, and `prune` commands.
- Produces: host packages that count at `PreCompact`, alert at `PostCompact` and `UserPromptSubmit`, and clean state at `SessionStart`.

- [ ] **Step 1: Write failing adapter tests**

```js
test('all host adapters run the Node counter at PreCompact', async () => {
  for (const file of ['hooks/hooks.json', 'kimi.plugin.json']) {
    const text = await readFile(file, 'utf8')
    assert.match(text, /compaction-watch\.mjs.*count/)
  }
})
```

- [ ] **Step 2: Run adapter tests and verify they fail**

Run: `node --test tests/manifests.test.mjs`

Expected: FAIL because the adapters still use shell scripts or are missing.

- [ ] **Step 3: Replace shell hook paths with Node adapter paths**

The repository root is the plugin root for all three hosts. Both marketplace entries use `"source": "./"`; this is necessary so the installed plugin includes the Node core. Codex relies on default `hooks/hooks.json` discovery rather than a manifest `hooks` field.

Configure these lifecycle events:

| Host | Event | Command |
| --- | --- | --- |
| Claude | `PreCompact` | `count --host claude` |
| Claude | `PostCompact` | `notify --host claude` |
| Claude | `UserPromptSubmit` | `notify --host claude --repeat` |
| Claude | `SessionStart` | `prune --host claude` |
| Codex | `PreCompact` | `count --host codex` |
| Codex | `PostCompact` | `notify --host codex` |
| Codex | `UserPromptSubmit` | `notify --host codex --repeat` |
| Codex | `SessionStart` | `prune --host codex` |
| Kimi | `PreCompact` | `count --host kimi` |
| Kimi | `PostCompact` | `notify --host kimi` |
| Kimi | `UserPromptSubmit` | `notify --host kimi --repeat` |
| Kimi | `SessionStart` | `prune --host kimi` |

Remove the terminal-only statusline integration. Desktop-visible hook output and best-effort OS notifications are the product surface.

- [ ] **Step 4: Update documentation and skill instructions**

Document the precise GUI behavior:

- Claude Desktop does not show terminal statusline output, but its plugin hooks can warn in the next chat turn and can trigger an OS notification.
- Codex Desktop displays hook system messages and can trigger an OS notification.
- Kimi CLI supports plugin hooks; Kimi VS Code requires empirical verification.
- `node bin/compaction-watch.mjs status --host <host>` displays the session count.

- [ ] **Step 5: Run every compaction-watch test**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the host packages**

```bash
git add .claude-plugin .codex-plugin .agents hooks skills kimi.plugin.json README.md tests
git rm -r plugins install.sh
git commit -m "feat: support Codex and Kimi compaction alerts"
```

## Task 5: Verify installation packages and install locally

**Files:**

- Modify: `auto-update-claude-md/README.md`
- Modify: `compaction-watch/README.md`
- Create: `auto-update-claude-md/tests/install-smoke.test.mjs`
- Create: `compaction-watch/tests/install-smoke.test.mjs`

**Interfaces:**

- Consumes: final package manifests and the installed `node`, `codex`, and `kimi` commands.
- Produces: verified local Codex and Kimi plugin installations plus documented Claude Desktop UI installation instructions.

- [ ] **Step 1: Write failing installation smoke tests**

```js
test('project-memory package contains all three host manifests', async () => {
  await access('.claude-plugin/marketplace.json')
  await access('.codex-plugin/plugin.json')
  await access('kimi.plugin.json')
})

test('compaction package contains all three host manifests', async () => {
  await access('.claude-plugin/marketplace.json')
  await access('.codex-plugin/plugin.json')
  await access('kimi.plugin.json')
})
```

- [ ] **Step 2: Run smoke tests and verify they fail until packaging is complete**

Run: `node --test tests/install-smoke.test.mjs`

Expected: FAIL before all host manifests exist and PASS after Tasks 2 and 4.

- [ ] **Step 3: Verify all repository tests and manifests**

Run:

```bash
cd C:/Users/jules/Downloads/auto-update-claude-md && node --test tests/*.test.mjs
cd C:/Users/jules/Downloads/compaction-watch && node --test tests/*.test.mjs
```

Expected: both commands exit 0.

- [ ] **Step 4: Install and inspect the Codex packages**

Run:

```bash
codex plugin marketplace add C:/Users/jules/Downloads/auto-update-claude-md
codex plugin marketplace add C:/Users/jules/Downloads/compaction-watch
codex plugin add auto-update-claude-md@auto-update-claude-md
codex plugin add compaction-watch@compaction-watch
codex plugin list
```

Expected: both plugins appear enabled or installed. Review and trust their hooks through the Codex hook UI if the app requests it.

- [ ] **Step 5: Install and inspect the Kimi packages**

Run the Kimi commands from an interactive Kimi session:

```text
/plugins install C:/Users/jules/Downloads/auto-update-claude-md
/plugins install C:/Users/jules/Downloads/compaction-watch
/plugins list
/reload
```

Expected: both plugins appear enabled. Start a new Kimi CLI session and trigger `/compact` to verify the count hook.

- [ ] **Step 6: Install Claude packages through Claude Desktop**

In the Claude Code Desktop local-session plugin browser, add the two local plugin directories and enable them. Start a new local Code session, initialize a disposable project with the memory command, and trigger compaction to verify the chat warning.

- [ ] **Step 7: Commit final documentation and smoke tests**

```bash
git add README.md tests
git commit -m "docs: document cross-agent installation"
```

## Task 6: Push both repositories

**Files:**

- No source changes.

**Interfaces:**

- Consumes: clean, committed `main` branches and authenticated `origin` remotes.
- Produces: pushed commits visible at both GitHub remotes.

- [ ] **Step 1: Check branch and worktree state**

Run:

```bash
git -C C:/Users/jules/Downloads/auto-update-claude-md status --short
git -C C:/Users/jules/Downloads/compaction-watch status --short
```

Expected: no uncommitted changes.

- [ ] **Step 2: Push auto-update-claude-md**

Run: `git -C C:/Users/jules/Downloads/auto-update-claude-md push origin main`

Expected: remote accepts all commits.

- [ ] **Step 3: Push compaction-watch**

Run: `git -C C:/Users/jules/Downloads/compaction-watch push origin main`

Expected: remote accepts all commits.

- [ ] **Step 4: Verify remote heads**

Run:

```bash
git -C C:/Users/jules/Downloads/auto-update-claude-md ls-remote --heads origin main
git -C C:/Users/jules/Downloads/compaction-watch ls-remote --heads origin main
```

Expected: each returned SHA matches its local `HEAD`.
