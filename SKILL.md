---
name: project-memory
description: Automatically maintain AGENTS.md project memory with a protected Read-Only goal (drift detection and propose-only updates), verified worked/failed handoff state, auto-consolidation into .memory/, and cross-project rules in ~/.project-memory/USER.md.
---

# Project memory

Paths below (`scripts/project-memory.mjs`, `templates/AGENTS.md`) are relative to this skill's directory.

## Automatic day-to-day behavior (zero manual invocation)

Read `AGENTS.md` in the active project's working directory (and `~/.project-memory/USER.md` once per session if it exists). If `AGENTS.md` does not exist, do nothing unless the user asks to create or initialize project memory (for example, *"crea un AGENTS.md"* or *"inicializa memoria"*).

When creating or initializing `AGENTS.md` in a project:
1. Run `node "<skill-dir>/scripts/project-memory.mjs" init --project "<target-project>"` (preserves any existing instructions).
2. If the project goal has critical ambiguity, ask brief clarifying questions first; otherwise populate `goal` (`Objective`, `Out of scope / limits`, `Done criteria`) once confirmed, and initialize `state`.

When `AGENTS.md` already exists, maintain it automatically during normal work:
- **Protected `goal` (`Read-Only` / `Propose-Only`)**:
  - Never modify inside `goal` markers during routine turn updates or consolidation.
  - Check active work against `goal` on meaningful turns: if your own work drifts into overengineering or extra scope, pull back to `goal`; if the user's direction changed or work uncovered a real nuance to the objective, leave `goal` untouched, flag it in 1-2 lines, and edit `goal` only after explicit user confirmation.
- **Active `state` handoff**:
  - Before the final reply on meaningful turns, update between `state` markers (reread from disk first; main agent owns edits when delegating): current state & next step, **what was tried (verified outcomes that worked + dead ends that failed and why)**, and accepted decisions/validation checks.
  - Leave `AGENTS.md` byte-for-byte unchanged on trivial Q&A or no-change turns. Never announce routine updates.
  - If an existing `AGENTS.md` has no managed markers yet, incorporate `<skill-dir>/templates/AGENTS.md` on its first meaningful update while preserving existing instructions, or run `upgrade` if it still uses legacy 4-marker `policy` + `state`. Report incomplete, duplicate, or out-of-order markers instead of overwriting.

## Automatic consolidation without losing past weeks (`.memory/`)

Keep `AGENTS.md` lean (~150-250 lines). Automatically when `AGENTS.md` exceeds ~250 lines - or whenever the user says `"consolida AGENTS.md"` - do this:
1. If the file still carries an older `policy` block or lacks `goal` markers, run `node "<skill-dir>/scripts/project-memory.mjs" upgrade --project "<target-project>"` first (preserves prefix, `goal`, and `state`).
2. Leave `goal` untouched. Rewrite `state` into a crisp active handoff: current focus & next step, active traps/dead ends, standing decisions, and validation checks.
3. Move older milestones (`YYYY-MM`), resolved investigations, and deep reference notes into plain Markdown files inside `<target-project>/.memory/` (e.g., `.memory/history.md` or `.memory/<topic>.md`), keeping a one-line summary link per file under `### Archive index`.

## Cross-project memory (`~/.project-memory/USER.md`)

Use `~/.project-memory/USER.md` only for durable user preferences, workflow habits, and lessons that apply across all projects. Create or update it only when the user states a cross-project rule or explicitly asks to remember something globally. Keep it concise (under 100 lines) and free of project-specific state.

## CLI helpers

- Initialize a project explicitly requested by the user:
  `node "<skill-dir>/scripts/project-memory.mjs" init --project "<target-project>"`
- Upgrade an existing initialized project's `policy` (and add `goal` markers to legacy files without touching `goal` or `state` content):
  `node "<skill-dir>/scripts/project-memory.mjs" upgrade --project "<target-project>"`
- Inspect `AGENTS.md` status (`active`, `initialized`):
  `node "<skill-dir>/scripts/project-memory.mjs" status --project "<target-project>"`
