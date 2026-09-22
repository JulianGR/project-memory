# Project Memory

Project Memory keeps a consolidated, repo-local handoff in AGENTS.md for code,
documents, research, and other project work. It requires Node.js 20 or later and
has no runtime dependencies or separate model API.

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

## Initialize

In the intended project root, send the exact standalone message:

```text
agent-memory:init
```

The installed prompt hook creates AGENTS.md if needed or appends managed
sections while preserving existing instructions. Repeating initialization does
not rewrite an already initialized file. The plugin activates only when all
four managed markers are present and correctly ordered, not merely because
some AGENTS.md exists.

AGENTS.md is the only project memory file the plugin creates or maintains.
Initialization does not import other documents, change other projects, or walk
up parent directories. The agent populates the managed state from verified
project context and the user's request. Run initialization from each intended
project root.

The initializer uses a temporary lock and atomic replacement. If initialization
is interrupted and leaves a lock, first confirm no initialization is running
before removing that specific lock. Normal hooks only read AGENTS.md.

## Every-turn integration

- SessionStart asks the agent to read AGENTS.md, including when a supported host
  resumes a session.
- UserPromptSubmit supplies the review instruction on every prompt.
- Stop in Codex and Claude requests one continuation to review memory before
  finishing. The `stop_hook_active` guard prevents a self-triggered loop.
  If review is already complete and nothing else changed, the agent can finish
  without further work.
- Kimi retains its existing session-start and prompt hooks. No Kimi Stop
  integration is claimed; turn-end maintenance relies on the inline policy.

Codex and Claude receive prompt context through `hookSpecificOutput.additionalContext`,
not just a visible `systemMessage`. The command-based Stop hook uses the shared
`decision: "block"` and `reason` protocol. These contracts are documented in
[Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude hooks](https://code.claude.com/docs/en/hooks).

The hook requests a semantic review by the active agent. It does not independently
decide what is relevant, verify the whole project, or write a summary. A review
may conclude that no write is warranted. This can add a continuation and token
cost even on question-only turns. Interrupted turns, disabled hooks, host
errors, and read-only sessions can prevent completion; do not equate a hook
invocation with a verified up-to-date memory.

## Install

### Codex

```text
codex plugin marketplace add JulianGR/project-memory
```

```text
codex plugin add project-memory@project-memory
```

Open a new task after installation or update. The host must support and enable
SessionStart, UserPromptSubmit, and Stop command hooks.

### Claude Code

```text
/plugin marketplace add JulianGR/project-memory
```

```text
/plugin install project-memory@project-memory
```

Restart the session after installation. Claude Code v2.1.277 introduced native
AGENTS.md support. In the default selection mode, a CLAUDE.md,
.claude/CLAUDE.md, or CLAUDE.local.md in the current directory or an ancestor can
take precedence. Check that the session reports AGENTS.md loaded, or choose
the mode that loads both in Project instructions. Some environments have
additional restrictions; see
[Claude project memory](https://code.claude.com/docs/en/memory#agents-md).
Project Memory does not change global Claude settings.

### Kimi Code CLI

```text
/plugins install https://github.com/JulianGR/project-memory
```

```text
/reload
```

Kimi uses AGENTS.md with prompt reminders. Kimi Code VS Code hook execution
remains unverified. Desktop hosts must be checked separately from their CLIs.
ChatGPT Web has no local project hooks and is not supported.

## Portability and concurrent work

The maintenance policy travels with AGENTS.md. Another agent that reads the
file can maintain it without this plugin; enforcement of each turn's review
depends on that host following the instructions or providing compatible hooks.

Before a memory edit, reread the latest file and patch only the relevant topic.
A coordinating agent owns memory writes from its subagents. The initialization
lock does not serialize later model edits from independent sessions; concurrent
sessions must reconcile edits rather than overwrite the document wholesale.
Keep the file under version control when the project uses Git, but do not rely
on commits or diffs to decide whether memory is relevant.

## Repository layout

| Path | Purpose |
| --- | --- |
| `.agents/plugins/marketplace.json` | Marketplace entry used to install the repository in Codex |
| `.codex-plugin/plugin.json` | Codex plugin manifest |
| `.claude-plugin/` | Claude plugin manifest and marketplace entry |
| `kimi.plugin.json` | Kimi plugin manifest and hook declarations |
| `hooks/hooks.json` | Default-discovered lifecycle hooks |
| `bin/` and `lib/` | Node entry point and shared runtime |
| `templates/AGENTS.md` | Initial maintenance policy and project state sections |
| `skills/project-memory/` | Agent instructions for initialization and maintenance |
| `tests/` | Development checks for initialization, preservation, and hooks |

The host manifests are installation metadata, not additional project memories.
The tests are not needed at runtime, but are kept to validate changes safely.

## Development checks

```text
node --test tests/*.test.mjs
```

For a diagnostic status check in the current project:

```text
node <plugin-root>/bin/project-memory.mjs status
```

Explicit initialization is also available through
`node <plugin-root>/bin/project-memory.mjs init` with the intended project as
the working directory and closed stdin. This changes AGENTS.md in that working
directory, not in the plugin checkout unless the checkout is the chosen target.

Tests exercise initialization, instruction preservation, idempotence, host
output formats, every-prompt reminders, and bounded Stop continuation in
temporary projects.
They do not prove that every model will always classify relevance correctly.

## License

MIT. See [LICENSE](LICENSE).
