---
name: project-memory
description: Set up or maintain a project's AGENTS.md as consolidated, repo-local memory for session handoffs. Use when asked to install Project Memory, enable it for a project, preserve decisions, or refresh durable context for Claude, Codex, or Kimi. Covers code and non-code work.
---

# Project memory

## Set up once

Use setup only when the user asks to install or enable project memory, not for questions about the plugin. Resolve the intended target project from the request or established project context. If it is ambiguous, ask once; never guess an ancestor, home directory, or the plugin checkout itself.

Resolve the plugin root from this skill's location. If host installation is needed, follow the local-repository steps in `<plugin-root>/README.md` for the chosen host. Do not register duplicate hooks in user or project settings, and do not bypass host trust or permission checks.

Run `node "<plugin-root>/bin/project-memory.mjs" init --project "<target-project>"`. This does not read stdin and works from any working directory. Verify using the same command with `status` instead of `init`. The installer performs both steps; the user does not need a special chat message to activate memory. If shell access is unavailable, report the setup limitation instead of claiming automatic maintenance is enabled.

The initializer creates only AGENTS.md and preserves existing instructions. It is idempotent and does not import or change other files. Read the resulting file, then populate its managed state from verified project context and the user's request. Consolidate by topic without discarding facts whose relevance is merely uncertain.

If partial or conflicting managed markers prevent initialization, explain the conflict; do not replace the file wholesale. If Claude loads an existing CLAUDE.md instead, report that compatibility issue rather than silently editing or removing it.

Confirm installation and the target project once, then let routine maintenance run without user reminders. A fresh host session may be required to load the installed hook. A successful initialization check proves the file has the managed sections, not that hooks have loaded or the state is semantically complete.

## Maintain

Follow the maintenance policy embedded in AGENTS.md. Review at the end of every turn, including non-code work. Write only when durable knowledge changes; leave the file byte-for-byte unchanged for a no-op review. Do not announce routine reviews, ask the user to request updates, or add a second response solely about memory. Surface only failures or conflicts that require user action.

Reread the latest file before a targeted edit within the state markers. Consolidate the current state instead of appending a turn history. Preserve still-valid decisions regardless of age, including their rationale and known validity conditions. Remove or replace information only on evidence of supersession or lost applicability. Distinguish accepted decisions from proposals and actual implementation from intentions. Do not turn a code discrepancy into an invented change of requirements.

The main agent owns memory edits when delegating. Preserve concurrent user edits, stable instructions, and markers. Do not add a second memory file, transcript archive, database, or global project store. A hook requests review; it does not itself determine truth or generate the summary. Never claim semantic freshness just because a hook ran.
