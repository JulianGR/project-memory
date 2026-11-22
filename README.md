# Project Memory

Minimal Agent Skill for automatic project continuity across **any kind of project** (software, pentesting, research, finance, writing) using just two mutually referenced Markdown files - with zero databases, zero hidden `.memory/` folders, and zero manual ceremonies:

1. **`SPEC.md` (Immutable goal anchor - `Read-Only` for AI)**: physically separated from live session notes so the real objective (`Objective`, `Out of scope / limits`, `Done criteria`) never dilutes across 100+ turns.
2. **`AGENTS.md` (Exclusive live handoff)**: where work stands, immediate next step, **what was tried (verified wins + failed dead ends and why)**, and standing decisions. Never pollutes `README.md`.

## Structure

```text
project-memory/
|-- SKILL.md                    # Agent skill instructions
|-- agents/openai.yaml          # UI metadata & implicit invocation policy
|-- scripts/project-memory.mjs  # Atomic zero-dependency CLI (init, upgrade, status)
|-- templates/SPEC.md           # Read-Only project specification template
|-- templates/AGENTS.md         # Managed policy + live state template
`-- tests/                      # Node.js built-in test suite
```

## Install (Single Source of Truth in `~/.agents/skills`)

```powershell
# Windows (PowerShell - no admin required)
New-Item -ItemType Junction -Path "$HOME\.agents\skills\project-memory" -Target "<repo-path>"
```

```sh
# macOS / Linux
ln -s "<repo-path>" "$HOME/.agents/skills/project-memory"
```

## Key Design Rules

- **Physical goal isolation (`SPEC.md` vs `AGENTS.md`)**: routine updates and consolidations touch only `AGENTS.md` (`state` markers) and never open `SPEC.md` for writing.
- **Automatic drift check**: on meaningful turns, the AI checks active work against `SPEC.md`. Overengineering is cut back automatically; genuine goal evolution or newly discovered nuances trigger a 1-2 line proposal and update `SPEC.md` only with explicit user approval.
- **Exclusive `AGENTS.md` + real distillation**: `README.md` is never used as session memory, and no hidden `.memory/` folders are created. Consolidation distills resolved work into 1-line rules/traps in `AGENTS.md` and leverages native `<subfolder>/AGENTS.md` files for multi-area projects.
- **Voice dictation awareness**: spoken `"legends.md"`, `"legend.md"`, or `"agent.md"` is automatically mapped to `AGENTS.md`.
- **Cross-project preferences (`~/.project-memory/USER.md`, optional)**: stores durable user workflow habits across all projects.

## CLI Helpers (Node.js 20+, zero dependencies)

```sh
node scripts/project-memory.mjs init --project "<project-path>"
node scripts/project-memory.mjs upgrade --project "<project-path>"
node scripts/project-memory.mjs status --project "<project-path>"
```

## Tests

```sh
npm test
```

## License

MIT. See [LICENSE](LICENSE).
