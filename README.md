# Project Memory

Project Memory keeps a fast, simple Markdown session handoff in `AGENTS.md` so any AI session can resume right where the previous one left off—knowing what was done, **what was tried (what worked and what failed)**, and what decisions apply—without databases, servers, or external APIs.

When `AGENTS.md` grows or you ask to consolidate it (`consolida AGENTS.md`), older milestones and deep topic details are archived into plain Markdown files under `.memory/` with one-line links in `AGENTS.md`, so startup stays light and nothing from weeks ago is lost. Cross-project user preferences can live optionally in `~/.project-memory/USER.md`.

In Codex, agents maintain `AGENTS.md` through instructions during normal work without hooks or forced continuations. Claude Code and Kimi retain their single `Stop` hook. Optional CLI commands require Node.js 20+ with zero runtime dependencies.

## Install from this repository

### Codex

```text
codex plugin marketplace add "<repo-path>"
codex plugin add project-memory@project-memory
```

Verify with `codex plugin list` and start a new session. Codex registers no lifecycle hooks; maintenance happens during normal turns.

### Claude Code

```text
claude plugin marketplace add "<repo-path>"
claude plugin install project-memory@project-memory
```

Restart the session after installation (Claude Code v2.1.277+ loads `AGENTS.md` natively).

### Kimi Code CLI

```text
/plugins install <repo-path>
/reload
```

## Simple 3-part Markdown model

1. **Active handoff (`AGENTS.md`, target ~150–250 lines)**:
   - Loaded automatically at session start.
   - Updated quietly on meaningful turns with:
     - `Current handoff and next steps`: exact current state and immediate next action.
     - `Tried: what worked and dead ends`: approaches tested, what worked, and **what failed + why** so future sessions never repeat dead ends.
     - `Decisions, constraints, and validation`: accepted decisions with rationale and commands to test/verify.
     - `Archive index`: one-line links to `.memory/*.md` files.
2. **Episodic & deep archive (`.memory/`, created only on consolidation)**:
   - When asked to consolidate `AGENTS.md` (or when `AGENTS.md` exceeds ~250 lines), the agent compacts `AGENTS.md` to active context and moves older weeks' history (`YYYY-MM` milestones, resolved investigations) or deep subsystem references into `.memory/history.md` or `.memory/<topic>.md`, linking them in `Archive index`.
3. **Cross-project user memory (`~/.project-memory/USER.md`, optional)**:
   - Read once per session if present. Written only when the user expresses durable workflow preferences or lessons that apply across all repositories.

## Optional CLI commands

Initialize `AGENTS.md` in a project (preserves existing instructions):

```text
node "<repo-path>/bin/project-memory.mjs" init --project "<project-path>"
```

Upgrade an older `policy` block in an already-initialized `AGENTS.md` without touching instructions or `state`:

```text
node "<repo-path>/bin/project-memory.mjs" upgrade --project "<project-path>"
```

Inspect `AGENTS.md` status (`active`, `initialized`) without modifying files:

```text
node "<repo-path>/bin/project-memory.mjs" status --project "<project-path>"
```

## Host behavior

| Host | Stop continuation |
| --- | --- |
| Codex | None; maintenance follows instructions within the normal turn |
| Claude Code | `Stop` `additionalContext`, without reporting a hook error |
| Kimi Code CLI | `permissionDecision: "deny"` with a review instruction |

## Development checks

```text
node --test tests/*.test.mjs
```

## License

MIT. See [LICENSE](LICENSE).