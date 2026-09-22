# Project Memory

Project Memory keeps a consolidated, repo-local handoff in AGENTS.md for code,
documents, research, and other project work. It requires Node.js 20 or later and
has no runtime dependencies or separate model API.

## Install from this repository

Give an installing agent this repository and a request such as:

> Install Project Memory from this directory for `<project-path>` in `<host>`.

The agent should complete this setup once. The user does not need a special
chat command to activate or update memory.

1. Resolve the downloaded repository, the intended project root, and the host.
   Ask if the target is unclear. Do not assume the installer repository, the
   home directory, or every project is the target.
2. Check that Node.js 20 or later is available. No `npm install` is needed.
3. Install using the host's local-repository commands below. If already
   installed, verify the marketplace source and update that installation
   instead of adding duplicate hooks.
4. Run the initialization and verification commands below with the explicit
   target project.
5. Read the resulting AGENTS.md and populate its state from verified project
   context and accepted decisions. Preserve existing instructions. Report
   conflicting or incomplete managed markers instead of replacing the file.
6. Verify that the host loads the plugin and trusts/enables its Stop hook
   through its normal controls. Do not bypass approvals or copy the hook into
   user/project settings. Reload or start a new session if required.
7. Confirm installation and the target once. Subsequent maintenance needs no
   user reminders or routine "memory updated" messages.

Initialize the selected target:

```text
node "<repo-path>/bin/project-memory.mjs" init --project "<project-path>"
```

Verify initialization:

```text
node "<repo-path>/bin/project-memory.mjs" status --project "<project-path>"
```

Both commands work from any directory and do not read standard input. The
status command returns `{"initialized":true}` when the managed sections exist;
it does not prove that the host loaded the hook or that the memory is complete.

Installing the plugin and enabling it for a project are separate steps. The
installing agent should complete both. Each new target project needs this
one-time initialization; installing the plugin does not opt in every project.
Keep the source repository available when the host uses a local path.

### Codex

```text
codex plugin marketplace add "<repo-path>"
```

```text
codex plugin add project-memory@project-memory
```

Use `codex plugin list` to verify installation. Open a new task after installation
or update. The host must support and enable plugin Stop command hooks. When
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

AGENTS.md contains a stable maintenance policy and a managed state section.
Other project instructions stay outside those sections and are preserved.

The agent reviews memory at the end of every turn, but writes only when durable
knowledge changes. A later session should be able to continue without the old
conversation. There is no turn log, commit log, transcript archive, database, or
global memory store.

| Situation | Expected action |
| --- | --- |
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

The initializer creates AGENTS.md or appends managed sections while preserving
existing instructions. Repeating initialization leaves an initialized file
unchanged. The plugin activates only when all four managed markers are present
and correctly ordered, not merely because some AGENTS.md exists.

AGENTS.md is the only project memory file the plugin creates or maintains.
Initialization does not import other documents, change other projects, or walk
up parent directories. Hooks use the host's project working directory; start
sessions in the initialized root.

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
