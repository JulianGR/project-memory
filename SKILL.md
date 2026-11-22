---
name: project-memory
description: Automatically maintain project continuity using SPEC.md (Read-Only goal anchor with drift detection) and AGENTS.md (exclusive live handoff with verified worked/failed state, real distillation, subfolder AGENTS.md support, and voice dictation handling for legends.md).
---

# Project memory

Paths below (`scripts/project-memory.mjs`, `templates/AGENTS.md`, `templates/SPEC.md`) are relative to this skill's directory.

## Core rules (zero manual invocation)

1. **Two mutually referenced files - nothing else**:
   - `SPEC.md`: immutable project goal anchor (`Read-Only` for AI; edit **only** after explicit user approval).
   - `AGENTS.md`: exclusive live session handoff (and `<subfolder>/AGENTS.md` when a project spans independent modules/subfolders).
   - **Never** use `README.md` as project memory, and **never** create `.memory/` directories or extra status/history files.
2. **Voice dictation alias (`legends.md` = `AGENTS.md`)**:
   - Voice dictation frequently transcribes `"AGENTS.md"` as `"legends.md"`, `"legend.md"`, or `"agent.md"`. Always interpret those as `AGENTS.md` and never create a `legends.md` file.
3. **Opt-in initialization**:
   - Read `SPEC.md` and `AGENTS.md` in the active project if they exist (plus `~/.project-memory/USER.md` once per session if present).
   - If `AGENTS.md` does not exist, do nothing unless the user asks to create or initialize memory (e.g., *"crea un AGENTS.md"* or dictated *"crea un legends.md"*).
   - When asked to initialize: run `node "<skill-dir>/scripts/project-memory.mjs" init --project "<target-project>"` (creates `SPEC.md` if missing and initializes `AGENTS.md` while preserving existing instructions). Clarify any critical ambiguity in the objective, fill `SPEC.md` once confirmed, and set initial `state` in `AGENTS.md`.

## Day-to-day automatic maintenance

- **Immutable `SPEC.md` & automatic drift check**:
  - Never touch `SPEC.md` during routine updates or consolidation.
  - On meaningful turns, compare active work against `SPEC.md`: if your own approach drifts into overengineering or unrequested scope, cut it back to `SPEC.md`; if the user's goal genuinely evolved or work revealed a key nuance, leave `SPEC.md` untouched, flag the mismatch in 1-2 lines, and update `SPEC.md` only after explicit user confirmation.
- **Live `AGENTS.md` handoff**:
  - Before the final reply on meaningful turns, reread `AGENTS.md` and quietly update between `state` markers (main agent integrates subagent findings): exact current state & next step, **what was tried (verified wins backed by real checks + failed dead ends and why)**, and accepted decisions/validation commands.
  - Leave `AGENTS.md` untouched on trivial Q&A or no-change turns. Never announce routine updates or store secrets.

## Consolidation by real distillation (no `.memory/`)

Keep `AGENTS.md` lean (~150-200 lines). When `AGENTS.md` grows past ~200 lines or the user asks to consolidate (e.g., `"consolida AGENTS.md"` or dictated `"consolida legends.md"`):
1. If `AGENTS.md` still carries an older `policy` block or lacks `SPEC.md`, run `node "<skill-dir>/scripts/project-memory.mjs" upgrade --project "<target-project>"` first (updates `policy` and creates `SPEC.md` if missing, never overwriting existing `SPEC.md` or `state`).
2. Leave `SPEC.md` untouched.
3. **Distill** resolved investigations and old dead ends into crisp 1-line conclusions/traps inside `AGENTS.md` rather than dumping history into `.memory/`.
4. When a project contains distinct submodules or areas in subfolders, place module-specific memory in `<subfolder>/AGENTS.md` (loaded natively by Codex and OpenCode when working in that subfolder) and keep root `AGENTS.md` focused on project-wide handoff.

## Cross-project memory (`~/.project-memory/USER.md`)

Use `~/.project-memory/USER.md` only for durable user preferences and workflow habits that apply across all projects (under 100 lines, zero project-specific state).

## CLI helpers

- `node "<skill-dir>/scripts/project-memory.mjs" init --project "<target-project>"`
- `node "<skill-dir>/scripts/project-memory.mjs" upgrade --project "<target-project>"`
- `node "<skill-dir>/scripts/project-memory.mjs" status --project "<target-project>"`
