---
name: auto-update-claude-md
description: Initialize and maintain concise, durable project memory for Claude, Codex, and Kimi.
---

# Project memory

Run `node bin/project-memory.mjs init` once for a project that should keep
durable memory. This creates `STATUS.md`, `AGENTS.md`, and `CLAUDE.md` without
overwriting existing files.

`AGENTS.md` and `CLAUDE.md` are identical pointers to the same operating rule.
Read `STATUS.md` before work or a handoff. Treat it as durable handoff memory,
not a transcript. Write only concise, factual, durable details such as decisions,
key paths, validation, blockers, and next actions. Do not add secrets, raw
conversation, speculation, or empty timestamp updates.
