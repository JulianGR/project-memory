---
name: project-memory
description: Maintain simple Markdown session handoffs in AGENTS.md (with tried/failed history, on-demand consolidation into .memory/, and cross-project preferences in ~/.project-memory/USER.md) or install Project Memory for Claude, Codex, or Kimi.
---

# Project memory

## Install once for the host

Install only when the user requests plugin installation, not for ordinary memory questions. Resolve `<plugin-root>` from this skill's directory and follow `<plugin-root>/README.md` for the active host:
- **Codex**: install at user level; register **no** hooks or forced continuations.
- **Claude Code / Kimi**: verify their single `Stop` hook without adding duplicate hooks or bypassing host approvals.

Do not scan unrelated projects or create `AGENTS.md` files during installation.

## Day-to-day handoff in `AGENTS.md`

Read `AGENTS.md` in the active project's working directory (and `~/.project-memory/USER.md` once per session if it exists). If `AGENTS.md` does not exist, do nothing unless the user asks to create or initialize memory (for example, *"crea un AGENTS.md para retomar"*).

When `AGENTS.md` exists, keep it ready so another AI can pick up immediately when the session closes:
- Update on meaningful turns before the final reply: what was done, exact current state & next step, **what was tried (both what worked and what failed + why)**, and accepted decisions/validation commands.
- Leave `AGENTS.md` byte-for-byte unchanged on trivial Q&A or turns with no durable outcome. Do not announce routine updates or ask for reminders.
- If an existing `AGENTS.md` has no managed markers yet, incorporate `<plugin-root>/templates/AGENTS.md` on its first meaningful update while preserving existing instructions. Report partial, duplicate, or out-of-order markers instead of overwriting.
- Reread `AGENTS.md` right before editing inside `state` markers. The main agent owns memory edits when delegating.

## Consolidate without losing past weeks (`.memory/`)

Keep `AGENTS.md` lean (~150–250 lines) so startup stays fast and clear. When the user asks to consolidate (for example, *"consolida AGENTS.md"*) or `AGENTS.md` grows past ~250 lines:
1. If the file still carries an older `policy` block, refresh only the `policy` block first via `node "<plugin-root>/bin/project-memory.mjs" upgrade --project "<target-project>"`.
2. Rewrite the `state` block into a crisp active handoff: current focus & next step, active dead ends/traps, standing decisions, and validation commands.
3. **Never throw away older weeks' context**: move resolved investigations, older milestones (`YYYY-MM`), and deep subsystem notes into plain Markdown files inside `<target-project>/.memory/` (e.g., `.memory/history.md` or `.memory/<topic>.md`), and leave a one-line summary link per file under `### Archive index` in `AGENTS.md`.

## Cross-project memory (`~/.project-memory/USER.md`)

Use `~/.project-memory/USER.md` only for durable user preferences, workflow habits, and lessons that apply across all repositories. Create or update it only when the user expresses a cross-project rule or explicitly asks to remember something globally. Keep it concise (<100 lines) and free of repo-specific details.

## Optional CLI commands

- Initialize a project explicitly requested by the user:
  `node "<plugin-root>/bin/project-memory.mjs" init --project "<target-project>"`
- Upgrade an existing initialized project's `policy` block without touching instructions or `state`:
  `node "<plugin-root>/bin/project-memory.mjs" upgrade --project "<target-project>"`
- Inspect `AGENTS.md` status (`active`, `initialized`):
  `node "<plugin-root>/bin/project-memory.mjs" status --project "<target-project>"`