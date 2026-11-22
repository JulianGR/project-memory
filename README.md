# Project Memory

Lightweight Agent Skill for keeping an automatic, plain-Markdown goal anchor and session handoff in `AGENTS.md` across **any kind of project** (software, pentesting, research, finance, writing) - without databases, servers, hooks, or manual ceremonies.

Every session resumes knowing:
1. **What the real goal is (`goal` block - Read-Only for AI)** so the objective never dilutes across 100+ turns and overengineering gets caught early.
2. **Where work stands (`state` block)** - exact next step, **what was tried (verified wins + failed dead ends and why)**, and standing decisions.
3. **Past weeks' history (`.memory/`)** when `AGENTS.md` grows past ~250 lines or you ask to consolidate (`consolida AGENTS.md`), plus optional cross-project preferences in `~/.project-memory/USER.md`.

## Structure

```text
project-memory/
|-- SKILL.md                    # Agent skill instructions
|-- agents/openai.yaml          # UI metadata & implicit invocation policy
|-- scripts/project-memory.mjs  # Atomic zero-dependency CLI (init, upgrade, status)
|-- templates/AGENTS.md         # Managed policy + goal + state template
`-- tests/                      # Node.js built-in test suite
```

## Install (Single Source of Truth in `~/.agents/skills`)

Clone the repo and link it into `~/.agents/skills/project-memory` (shared automatically by Codex / ChatGPT Desktop, OpenRouter profiles, and OpenCode):

```powershell
# Windows (PowerShell - no admin required)
New-Item -ItemType Junction -Path "$HOME\.agents\skills\project-memory" -Target "<repo-path>"
```

```sh
# macOS / Linux
ln -s "<repo-path>" "$HOME/.agents/skills/project-memory"
```

Or install directly via the `skills` CLI:

```sh
npx skills add JulianGR/project-memory
```

## How It Works

1. **Protected goal anchor (`goal` markers - `Read-Only` / `Propose-Only`)**:
   - Holds `Objective`, `Out of scope / limits`, and `Done criteria`.
   - Never edited by the AI during routine updates or consolidation.
   - **Automatic drift check**: compares active work against `goal`. Cuts unrequested overengineering; if your direction genuinely evolved or uncovered a nuance, proposes a 1-2 line update and edits `goal` only after explicit approval.
2. **Active handoff (`state` markers, ~150-250 lines)**:
   - Updated quietly on meaningful turns with current state & next step, verified wins + failed dead ends (and why), accepted decisions, and validation checks.
3. **Automatic episodic archive (`.memory/`)**:
   - When `AGENTS.md` exceeds ~250 lines or you say `"consolida AGENTS.md"`, compacts `state` (leaving `goal` untouched) and moves older milestones/investigations into `.memory/*.md` with one-line links in `Archive index`.
4. **Cross-project preferences (`~/.project-memory/USER.md`, optional)**:
   - Read once per session if present; stores only durable rules that apply across all projects.

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
