# Cross-agent project memory and compaction watch design

## Purpose

Evolve `auto-update-claude-md` and `compaction-watch` into two related tools
that work across Claude Code Desktop, Codex Desktop, and Kimi Code CLI. Both
tools must run on Windows, macOS, and Linux without requiring Bash.

The tools share a project-memory protocol but remain independently installable
and independently useful:

- `auto-update-claude-md` maintains useful project memory in `STATUS.md`.
- `compaction-watch` counts context compactions and warns before repeated
  compaction degrades the working session.

## Supported surfaces

| Surface | Project instruction file | Compaction hooks | In-app warning | Native OS notification |
| --- | --- | --- | --- | --- |
| Claude Code Desktop, local or SSH session | `CLAUDE.md` | Yes | On the next submitted prompt | Yes |
| Codex Desktop, local session | `AGENTS.md` | Yes | Hook system message | Yes |
| Kimi Code CLI | `AGENTS.md` | Yes | Hook output when supported by the client | Yes |
| Kimi Code VS Code extension | `AGENTS.md` if the underlying CLI loads it | Experimental | Experimental | Yes if the extension executes Kimi CLI hooks |
| Claude remote session, ChatGPT web | Not in scope | No local hook guarantee | Not in scope | No |

The Claude Code Desktop app shares its Code settings, hooks, plugins, and
`CLAUDE.md` behavior with Claude Code. Codex Desktop shares local configuration
with Codex. Kimi Code CLI supports the required hooks. The Kimi VS Code
extension does not document equivalent hook execution for current Kimi CLI
releases, so it remains an explicit integration test target rather than a
compatibility promise.

## Project-memory protocol

### Opt-in model

Only projects initialized with the tool participate. Initialization creates
these three root files:

- `STATUS.md`
- `AGENTS.md`
- `CLAUDE.md`

The presence of `STATUS.md` is the opt-in marker. Hooks do nothing in projects
without it. This prevents a globally installed plugin from creating agent files
in every directory a user opens.

### Pointer files

`AGENTS.md` and `CLAUDE.md` are byte-for-byte identical. They stay short and
contain only durable operating rules:

1. Read `STATUS.md` before planning, editing, or resuming work.
2. Treat it as the authoritative project memory.
3. Update it after meaningful changes, decisions, discoveries, failures, or
   validation.
4. Keep it factual, concise, and safe to commit.
5. Do not include secrets, raw transcripts, or speculative claims.

The two filenames support the agents in scope without forking the project
memory. Kimi and Codex use `AGENTS.md`; Claude Code uses `CLAUDE.md`.

### `STATUS.md` structure

The initializer creates a stable template with these sections:

1. Project purpose and boundaries
2. Architecture and key paths
3. Current state and active work
4. Decisions and rationale
5. Commands and validation status
6. Known risks, blockers, and assumptions
7. Next actions in priority order
8. Last updated metadata

`STATUS.md` is a handoff document, not a transcript. It must be short enough
to read at the start of every session. The update prompt requires the agent to
replace stale facts, retain important decisions, and remove obsolete detail.
Future releases may add archived session notes, but the first release does not
create a second history system.

### Automatic reminders

Each installed host maintains a per-project, per-session message counter outside
the repository. The default reminder interval is four user prompts and is
configurable through an environment variable or host-specific configuration.

On a reminder, the tool asks the active agent to update `STATUS.md` only when
new durable facts exist. It must not make empty timestamp-only edits.

Claude Code and Kimi CLI can receive this reminder through their prompt hook
output. Codex hooks can surface a visible system message but do not provide an
equivalent documented semantic-context injection. For Codex, the identical
`AGENTS.md` rule is the primary mechanism and hooks add a visible checkpoint
warning. The implementation must describe this limitation accurately and must
not claim a guaranteed semantic update every four turns in Codex.

## Compaction-watch protocol

### State

The counter is stored outside the repository under a single cross-platform
state root. It is keyed by:

- host: `claude`, `codex`, or `kimi`
- normalized project path hash
- session id

This isolates simultaneous sessions and prevents state files from appearing in
Git. A session start hook removes expired state safely.

### Events and thresholds

Each host adapter invokes the shared Node runner on `PreCompact`. The runner
increments the counter atomically and records the trigger (`auto` or `manual`).

Default thresholds are:

- 5 compactations: soft warning
- 10 compactations: strong warning recommending a new session

The state command reports the exact count, current threshold, and whether the
warning came from an automatic or manual compact operation. Thresholds and
reminder frequency remain configurable.

### Notifications

Warnings use two paths:

1. A host-visible message where the host supports it.
2. A best-effort native notification at the threshold crossing.

The native notification layer uses only operating-system facilities:

- Windows: PowerShell toast support
- macOS: `osascript`
- Linux: `notify-send` when available

Notification failure must never block compaction or a user prompt. Terminal
statusline output remains an optional CLI-only enhancement and is not the
primary warning mechanism because desktop GUIs do not render it.

## Repository architecture

Each repository contains a small Node.js runner and thin host adapters. No
shared third repository is introduced in this release because that would make
installation and versioning materially more complicated.

### `auto-update-claude-md`

- A portable Node entry point initializes the three project files, increments
  counters, detects `STATUS.md`, and emits host-appropriate reminder output.
- Host manifests and hooks are added for Claude, Codex, and Kimi.
- A status-template asset is the single source for the initialized file format.
- A `status` command reports whether a project is initialized and when its
  current status file was last meaningfully updated.

### `compaction-watch`

- A portable Node entry point receives hook JSON, stores session counters,
  formats warnings, and sends best-effort native notifications.
- Host manifests and hooks are added for Claude, Codex, and Kimi.
- A `status` command returns the active session counter in a form suitable for
  an agent response or terminal output.
- Existing shell scripts are retired only after behavior-compatible Node tests
  pass.

## Installation model

The repositories expose native plugin packages where each host supports them:

- Claude Code Desktop installs the Claude package through its Plugins UI.
- Codex Desktop uses the Codex plugin package and shares the installed local
  configuration with Codex CLI.
- Kimi Code CLI installs the Kimi package through `/plugins install` and reloads
  the plugin in a new session.

Manual Node installers are available for local development and should only add
or update their own configuration entries. They must make a backup before
modifying a host config file and must be idempotent.

## Error handling and privacy

- Hooks fail open. A broken plugin must never block compaction, a prompt, or a
  coding session.
- State files contain counters, paths encoded as hashes, timestamps, host ids,
  and session ids. They do not contain prompts, transcript text, code, tokens,
  or secrets.
- `STATUS.md` is user-authored project documentation. Agents must avoid secrets
  and must preserve any existing user content during template upgrades.

## Verification

Automated tests cover:

1. Status initialization, idempotency, and identical pointer files
2. Reminder cadence and opt-in behavior
3. Session-key isolation and threshold transitions
4. Claude, Codex, and Kimi hook payload normalization
5. Notification command selection without invoking an actual desktop popup
6. Manifest validity and command paths for every host
7. Windows, macOS, and Linux path handling through fixtures

Manual acceptance tests cover local Claude Desktop, Codex Desktop, Kimi CLI,
and Kimi VS Code if its installed extension invokes the current CLI hooks.

## Out of scope

- ChatGPT web integration
- A permanent transcript archive
- Sending project memory to a remote service
- Changing any agent's built-in compaction algorithm
- Guaranteed automatic semantic updates in hosts that cannot inject a reminder
  into the agent context
