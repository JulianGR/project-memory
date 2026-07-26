# Project Memory

Project Memory keeps a short, durable handoff document for serious coding
projects. It supports Claude Code, Codex Desktop, and Kimi Code CLI on Windows,
macOS, and Linux. It requires Node.js 20 or later and has no dependencies.

It is not supported by ChatGPT Web. Kimi Code VS Code support is experimental.

## What it creates

In the target project, send this exact standalone message once through Claude,
Codex, or Kimi:

```text
agent-memory:init
```

The installed prompt hook creates these files without overwriting existing ones:

- `STATUS.md` is the durable project handoff memory, not a transcript.
- `AGENTS.md` and `CLAUDE.md` are identical pointers that tell agents to read
  `STATUS.md` before work and write only durable facts.

The prompt hook is inactive until `STATUS.md` exists. Every four user prompts by
default, it checks whether the agent should update durable memory. It stores its
per-session counter outside the project under the user's home directory.

## Install

### Codex

Add the repository marketplace, then install the plugin:

```text
codex plugin marketplace add JulianGR/auto-update-claude-md
codex plugin add auto-update-claude-md@auto-update-claude-md
```

Restart or open a new task after installation. Codex shows a visible checkpoint
through its hook output; the semantic rule remains the project's `AGENTS.md`.

### Claude Code

In a Claude Code session, add the repository marketplace and install the root
plugin package:

```text
/plugin marketplace add JulianGR/auto-update-claude-md
/plugin install auto-update-claude-md@auto-update-claude-md
```

Restart the session after installation. Claude receives the cadence reminder as
prompt context and follows the project's `CLAUDE.md` pointer.

### Claude Desktop

Use Claude Desktop's local Code/plugin UI when it is available to add the
`JulianGR/auto-update-claude-md` marketplace and install
`auto-update-claude-md`. The Claude Code slash commands above are for Claude
Code sessions, not a claim that Claude Desktop is a CLI wrapper.

### Kimi Code CLI

From an interactive Kimi Code CLI session, install the repository root and then
reload:

```text
/plugins install https://github.com/JulianGR/auto-update-claude-md
/reload
```

Kimi CLI receives cadence context from its plugin hooks and uses `AGENTS.md`.
Kimi Code VS Code may load the same project instructions, but hook execution has
not been confirmed and remains experimental.

## Cadence configuration

Set `AGENT_MEMORY_INTERVAL` to a positive integer in the host environment. The
default is `4`. `AUTO_UPDATE_CLAUDE_N` remains a backward-compatible fallback.

```text
AGENT_MEMORY_INTERVAL=8
```

On Windows, set this environment variable through the terminal or the host's
environment settings before starting the host. On macOS and Linux, export it
from the shell or configure it in the host's launch environment.

## Native limitations

- Claude Code and Kimi CLI can attach the periodic reminder to the agent's
  prompt context.
- Codex Desktop exposes the checkpoint as a visible system message. It does not
  guarantee a semantic memory update, so `AGENTS.md` is the durable rule.
- No desktop application is a wrapper around its CLI. Install and behavior are
  documented separately above.
- ChatGPT Web has no local project hooks and is not supported.

## Verify

For plugin contributors, run these from the plugin checkout on Windows, macOS,
or Linux:

```text
node --test tests/*.test.mjs
node bin/project-memory.mjs init
node bin/project-memory.mjs status
```

Run the Codex `validate_plugin.py .` command from your Codex plugin developer
tooling if it is installed. The direct binary commands are checkout diagnostics;
installed users initialize a project by sending `agent-memory:init`.

## License

MIT. See [LICENSE](LICENSE).
