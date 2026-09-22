---
name: project-memory
description: Initialize or maintain a project's AGENTS.md as a consolidated, repo-local memory for session handoffs. Use when asked to enable project memory, preserve decisions, or refresh durable project context for Claude, Codex, or Kimi. Covers code and non-code work.
---

# Project memory

## Initialize

Use this workflow only when the user requests initialization, not for every question about the plugin. Work in the intended project root, never the plugin directory or a guessed ancestor.

The installed prompt hook accepts the exact standalone user message `agent-memory:init`. If initialization is requested in natural language and shell access is available, run `node <plugin-root>/bin/project-memory.mjs init` with the intended project root as the working directory and closed stdin. Resolve the plugin root from this skill's location. Otherwise ask the user to send the literal marker in the target project.

The initializer creates only AGENTS.md and preserves existing instructions. It is idempotent and does not import or change other files. Read the resulting file, then populate its managed state from verified project context and the user's request. Consolidate by topic without discarding facts whose relevance is merely uncertain.

If partial or conflicting managed markers prevent initialization, explain the conflict; do not replace the file wholesale. If Claude loads an existing CLAUDE.md instead, report that compatibility issue rather than silently editing or removing it.

## Maintain

Follow the maintenance policy embedded in AGENTS.md. Review at the end of every turn, including non-code work. Write only when durable knowledge changes; leave the file byte-for-byte unchanged for a no-op review.

Reread the latest file before a targeted edit within the state markers. Consolidate the current state instead of appending a turn history. Preserve still-valid decisions regardless of age, including their rationale and known validity conditions. Remove or replace information only on evidence of supersession or lost applicability. Distinguish accepted decisions from proposals and actual implementation from intentions. Do not turn a code discrepancy into an invented change of requirements.

The main agent owns memory edits when delegating. Preserve concurrent user edits, stable instructions, and markers. Do not add a second memory file, transcript archive, database, or global project store. A hook requests review; it does not itself determine truth or generate the summary. Never claim semantic freshness just because a hook ran.
