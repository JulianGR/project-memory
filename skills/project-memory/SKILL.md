---
name: project-memory
description: Install Project Memory for an agent host or maintain existing project AGENTS.md files as consolidated, repo-local memory. Use when asked to install Project Memory, preserve decisions, or refresh durable context for Claude, Codex, or Kimi. Covers code and non-code work.
---

# Project memory

## Install once for the host

Install only when the user requests it, not for questions about the plugin. Resolve the host from the request or current session. Follow the local-repository instructions in `<plugin-root>/README.md`, resolving the plugin root from this skill's location. In Codex, install for the current user and rely on AGENTS.md instructions for memory maintenance. Do not register hooks or force continuations in Codex. Other hosts require their own installation. Do not bypass host trust or permission checks or register duplicate hooks in user or project settings.

No target project, initialization command, or managed markers are required to install or activate the plugin. Codex maintains existing AGENTS.md files through instructions within the normal turn. Claude Code and Kimi retain their host-specific Stop hooks. Do not ask the user to opt in each repository. Do not scan other projects, create AGENTS.md files during installation, or assume the plugin checkout is a memory target.

Verify the installed/enabled plugin and that Codex registers no Project Memory hooks. For Claude Code and Kimi, verify their single Stop hook instead. Confirm installation once. A new host session may be required. If shell access is unavailable, report the limitation instead of claiming installation succeeded. If Claude loads CLAUDE.md instead of AGENTS.md at startup, report that loading distinction rather than silently editing other instructions.

## Maintain existing AGENTS.md

Read AGENTS.md in the active project's working directory. If it does not exist, do nothing unless the user explicitly requested creation. Do not walk parent directories or create a missing file just because the plugin is installed.

During normal work, including non-code tasks, update memory before the final response when durable knowledge changes. In Codex, review and writing are not required on every turn, and pending memory work does not prevent the task from finishing. Leave the file byte-for-byte unchanged when there is nothing useful to add. Do not announce routine reviews, ask for reminders or per-project activation, or add a second response solely about memory. Surface only failures or conflicts that require user action.

For an existing file without managed sections, no setup request is needed. On its first relevant update, read `<plugin-root>/templates/AGENTS.md` and incorporate its maintenance policy and managed state, preserving existing instructions and valid knowledge. Do not add empty sections merely to mark a review. Partial, duplicate, or out-of-order managed markers are a conflict: preserve the file and report the issue instead of appending another block or replacing it wholesale.

Once managed sections exist, follow their embedded policy. Reread the latest file before a targeted edit within the state markers. If the file disappeared, do not recreate it automatically. Consolidate the current state instead of appending a turn history. Preserve still-valid decisions regardless of age, including rationale and known validity conditions. Remove information only on evidence of supersession or lost applicability. Distinguish accepted decisions from proposals and actual implementation from intentions.

The main agent owns memory edits when delegating. Preserve concurrent user edits, stable instructions, and markers. Do not add a second memory file, transcript archive, database, or global project store. A hook requests review; it does not determine truth or generate the summary. Never claim semantic freshness just because a hook ran.

## Optional file creation

Only when the user explicitly asks to create AGENTS.md or initialize a project without one, resolve the intended target and run `node "<plugin-root>/bin/project-memory.mjs" init --project "<target-project>"`. Ask if that target is unclear. This command preserves existing instructions and does not read stdin. Populate the resulting managed state from verified context. The `status --project "<target-project>"` command reports whether AGENTS.md exists (`active`) and has complete managed markers (`initialized`); neither field proves that the host loaded its hook or the memory is complete.
