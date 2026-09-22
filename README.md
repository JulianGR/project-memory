# Project Memory

Project Memory keeps a consolidated, repo-local handoff in AGENTS.md for code,
documents, research, and other project work. Install it once in the agent host:
it reviews any active project that already has AGENTS.md, without per-project
activation. It requires Node.js 20 or later and has no runtime dependencies or
separate model API.

## Install from this repository

Give an installing agent this repository and a request such as:

> Install Project Memory from this directory in `<host>`.

The agent should complete this setup once for the selected host. In Codex,
installation is user-level and applies across that user's projects, not across
other operating-system accounts or unconfigured AI tools.

1. Resolve the downloaded repository and the host. A target project is not
   required for installation.
2. Check that Node.js 20 or later is available. No `npm install` is needed.
3. Install using the host's local-repository commands below. If already
   installed, verify the marketplace source and update that installation
   instead of adding duplicate hooks.
4. Verify that the host loads the plugin and trusts/enables its single Stop hook
   through its normal controls. Do not bypass approvals or copy the hook into
   user/project settings. Reload or start a new session if required.
5. Confirm installation once. Do not ask the user to select or initialize each
   project. Subsequent maintenance needs no reminders or routine "memory
   updated" messages.

Once the hook is loaded, an existing AGENTS.md in the active project's working
directory is sufficient. The file may be empty, ordinary instructions, or an
existing managed memory. The plugin does not scan other directories or create
missing AGENTS.md files during installation or automatic reviews. Keep the
source repository available when the host uses a local path.

### Codex

```text
codex plugin marketplace add "<repo-path>"
```

```text
codex plugin add project-memory@project-memory
```

Use `codex plugin list` to verify installation. Open a new task after installation
or update. The user-level plugin then applies to projects with AGENTS.md without
an initialization command. The host must support and enable plugin Stop command hooks. When
developing a locally cached plugin, follow the host's version/update workflow
so the new definition is loaded rather than an old cached copy.

### Claude Code

```text
claude plugin marketplace add "<repo-path>"
```

```text
claude plugin install project-memory@project-memory
```

Restart the session after installation. Use a version supporting Stop
`additionalContext` continuation and native AGENTS.md loading. Claude Code
v2.1.277 introduced native AGENTS.md support. In the default selection mode,
an existing CLAUDE.md, .claude/CLAUDE.md, or CLAUDE.local.md can take precedence.
Check that the session reports AGENTS.md loaded, or select the mode that loads
both in Project instructions. Report conflicts instead of deleting other
instructions. See [Claude project memory](https://code.claude.com/docs/en/memory#agents-md).
Project Memory does not change global Claude settings or create CLAUDE.md.

### Kimi Code CLI

In a Kimi session, install from the downloaded directory and reload:

```text
/plugins install <repo-path>
```

```text
/reload
```

Use a version supporting plugin Stop hooks and bounded Stop continuation.
See [Kimi plugin installation and hooks](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/customization/plugins.md).
Kimi Code VS Code hook execution remains unverified. Desktop hosts must be
checked separately from their CLIs. ChatGPT Web has no local project hooks
and is not supported.

## Memory model

AGENTS.md is detected by its presence, not by special markers. On the first
relevant update to an unmanaged file, the agent incorporates the template's
maintenance policy and managed state, preserving existing instructions and
still-valid knowledge. This is automatic and does not require an activation
request. A no-change review leaves the file untouched, including when it has
no managed sections yet.

After adoption, other project instructions stay outside the managed sections
and are preserved. Partial, duplicate, or out-of-order managed markers are a
conflict to report, not permission to overwrite the file or append another block.

The agent reviews memory at the end of every turn, but writes only when durable
knowledge changes. A later session should be able to continue without the old
conversation. There is no turn log, commit log, transcript archive, database, or
global memory store.

| Situation | Expected action |
| --- | --- |
| No AGENTS.md exists in the active project directory | Do nothing; do not create it automatically |
| A question repeats existing information | Leave AGENTS.md unchanged |
| A feature, document, requirement, or accepted decision changes | Update its current topic |
| An old decision still applies | Keep the decision and its rationale |
| Current evidence establishes that an entry was superseded | Replace or remove it |
| Relevance is uncertain or implementation conflicts with a requirement | Preserve the decision and identify the uncertainty |

Decisions carry their reason, scope, and known validity conditions, not manual
retention tags. For example: "Use local files because the workflow must run
offline; revisit if shared concurrent editing becomes a requirement." Age or
absence from the latest conversation is not a reason to discard a decision.
The agent must not invent a reason or a condition that the project never had.

AGENTS.md is the only project memory file the plugin creates or maintains.
The hook uses the host's project working directory and does not walk up parent
directories. Start sessions in the project root containing AGENTS.md. It reviews
the project being worked on, not every repository on disk at once.

## Optional creation and diagnostics

No initialization command is needed for an existing AGENTS.md. If the user
explicitly wants to create one in a project that lacks it, the installer can run:

```text
node "<repo-path>/bin/project-memory.mjs" init --project "<project-path>"
```

This optional initializer preserves existing instructions, refuses conflicting
markers, and leaves an already initialized file unchanged. It does not import
other documents or change other projects. Populate the managed state from
verified project context after explicitly creating it.

To inspect one project without changing it:

```text
node "<repo-path>/bin/project-memory.mjs" status --project "<project-path>"
```

Both commands work from any directory and do not read standard input. Status
returns `active: true` for an existing readable AGENTS.md, including one with no
managed sections. `initialized: true` additionally means all four managed
markers are present and correctly ordered. These fields describe the file,
not whether the host loaded its hook or the memory is semantically complete.

Initialization uses a temporary lock and atomic replacement. If interrupted
initialization leaves a lock, confirm no initialization is running before
removing that specific lock. Normal hooks only read AGENTS.md.

## One hook, at turn end

Each supported host registers exactly one hook: Stop. There are no startup
or prompt-submission hooks. Codex and Claude discover the same
`hooks/hooks.json`; Kimi declares its Stop hook in `kimi.plugin.json`.

| Host | Stop continuation |
| --- | --- |
| Codex | `decision: "block"` with a review instruction in `reason` |
| Claude Code | Stop `additionalContext`, without reporting a hook error |
| Kimi Code CLI | `permissionDecision: "deny"` with a review instruction |

The runtime distinguishes Codex's event by its `turn_id`; Kimi passes an
explicit host option. The `stop_hook_active` guard skips nested reviews in
Codex and Claude. Kimi also bounds continuation in its host implementation.
If the review was already completed and nothing new changed, the agent can
finish without repeating it. See the
[Codex Stop contract](https://learn.chatgpt.com/docs/hooks#stop),
[Claude Stop contract](https://code.claude.com/docs/en/hooks#stop-decision-control),
and [Kimi hook contract](https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/hooks.md).

The hook asks the active agent to maintain memory quietly, without asking the
user for reminders or adding a second response just to announce maintenance.
Real failures, conflicts, and required permissions may still need user input.
The host can display hook activity or feedback; the plugin cannot hide host UI.

One registered hook is not a guarantee of one invocation or zero extra model
work. Stop may add a continuation and token cost even for question-only turns.
The hook does not itself classify relevance, verify the whole project, or write
a summary. Interrupted turns, disabled hooks, host errors, and read-only
sessions can prevent completion. Hook input/runtime failures fail open rather
than blocking the user's work. Invocation alone does not prove memory is current.

## Portability and concurrent work

The maintenance policy travels with AGENTS.md. Another agent that reads the
file can maintain it without this plugin; automatic turn-end review depends
on that host loading compatible hooks or following the embedded instructions.

Before a memory edit, reread the latest file and patch only the relevant topic.
A coordinating agent owns memory writes from its subagents. The initialization
lock does not serialize later model edits from independent sessions; concurrent
sessions must reconcile edits rather than overwrite the document wholesale.
Keep the file under version control when the project uses Git, but do not rely
on commits or diffs to decide whether memory is relevant.

## Repository layout

| Path | Purpose |
| --- | --- |
| `.agents/plugins/marketplace.json` | Local-repository marketplace entry for Codex |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.claude-plugin/` | Claude plugin manifest and marketplace entry |
| `kimi.plugin.json` | Kimi plugin manifest and single Stop hook |
| `hooks/hooks.json` | One default-discovered Stop hook for Codex and Claude |
| `bin/` and `lib/` | Node entry point and shared runtime |
| `templates/AGENTS.md` | Initial maintenance policy and project state sections |
| `skills/project-memory/` | Agent instructions for installation and maintenance |
| `tests/` | Development checks for initialization, preservation, and hooks |

Host manifests are installation metadata, not additional project memories.
Tests are not needed at runtime, but are kept to validate changes safely.

## Development checks

```text
node --test tests/*.test.mjs
```

Tests use temporary projects to check explicit target selection, initialization
without stdin, instruction preservation, byte-level idempotence, installed-copy
execution, host output formats, loop guards, and the single-hook manifests.
They do not prove that every model will always classify relevance correctly.

## License

MIT. See [LICENSE](LICENSE).
