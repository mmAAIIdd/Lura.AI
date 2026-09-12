---
name: agent-skill-authoring
description: The agent and skill file formats actually supported by the Claude Code version installed here (2.1.191), verified against the binary rather than from memory — frontmatter fields, tool restriction semantics, the zero-tool configuration, per-agent hooks, and Lura's rules for what deserves to be a skill. Use when creating or editing anything under .claude/agents or .claude/skills.
---

# Authoring agents and skills for this repository

Installed: **Claude Code 2.1.191**. Everything below was verified against that binary's
own schema definitions. **Do not add a frontmatter field that is not listed here** — the
agent schema is `.strict()`, and an unrecognized key is silently dropped rather than
reported as an error, so an invented field looks like it worked and does nothing.

## Agent files — `.claude/agents/<name>.md`

| Field | Meaning |
|---|---|
| `name` | **required** — how the Agent tool and `--agent` address it |
| `description` | **required** — when to use this agent; shown in the Agent tool listing |
| `tools` | tools available to this agent. **Replaces** the default set |
| `disallowedTools` | removed from the default set. **Ignored when `tools` is set** |
| `model` | override, or `inherit` |
| `effort` | `low` · `medium` · `high` · `xhigh` · `max`, or an integer |
| `permissionMode` | `default` · `acceptEdits` · `bypassPermissions` · `plan` · `dontAsk` · `auto` |
| `skills` | skills preloaded for this agent |
| `mcpServers` | MCP servers connected while it runs |
| `hooks` | hooks registered while it runs |
| `maxTurns` | positive integer |
| `color` | display colour |
| `memory` | `user` · `project` · `local` |
| `background`, `isolation`, `initialPrompt` | rarely needed here |

`tools` accepts a comma-separated string or a YAML list.

### Zero tools

`tools: []` parses to an empty list, and the version's own validator describes that state
as *"No tools selected - agent will have very limited capabilities"*. It is a supported
configuration, not a parse failure. Omitting `tools` entirely means **all** tools — the
opposite. A `*` entry also means all tools.

Two caveats:

- Setting `memory:` alongside `tools` causes the loader to append memory tools to the list.
  **An agent that must have zero tools must not set `memory:`.**
- **The Agent tool listing displays `tools: []` as `(Tools: All tools)`.** This is a
  formatter bug, not the real permission: the listing helper tests `tools.length > 0` and
  falls through to the "all" label, while the runtime resolver treats `undefined` as all
  and `[]` as none. Verified by spawning `independent-advisor`, which reported an empty
  tool set and made zero tool calls. Never "correct" a zero-tool agent in response to that
  label — you would be changing real behaviour to fix display text.

`independent-advisor` depends on this. Do not add `tools`, `skills` or `memory` to it.

### Per-agent hooks

Agent frontmatter accepts a hook map keyed by event (`PreToolUse`, `PostToolUse`, `Stop`,
`SubagentStop`, and others), each with `matcher` and `hooks` entries:

```yaml
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: node
          args: [".claude/hooks/guard.mjs"]
          timeout: 15
```

With `args` present, `command` is spawned directly as an executable — no shell, so paths
containing spaces, `$` or quotes are safe. Without `args`, the string runs through a shell
(bash, or PowerShell on Windows without Git Bash). **Prefer the `args` form here** — this
repository lives under a path with spaces and Cyrillic characters.

A `PreToolUse` hook denies a call by writing this to stdout and exiting `0`:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse",
 "permissionDecision":"deny","permissionDecisionReason":"..."}}
```

`.claude/hooks/restrict-write-scope.mjs` is the working example. It exists because the
installed version has **no per-agent, per-path permission field** — `permissions.allow` and
`deny` in `settings.json` are session-global. A hook is the only per-agent path control
available, so reach for it when a boundary matters.

**The PreToolUse payload identifies the calling agent.** Observed fields:

```
agent_id, agent_type, cwd, effort, hook_event_name, permission_mode,
session_id, tool_input, tool_name, tool_use_id, transcript_path
```

`agent_type` carries the agent's name (`"skill-curator"`), and it is absent for the main
session. `CLAUDE_PROJECT_DIR` is present in the hook's environment. That means **one hook
registered in `settings.json` can enforce per-agent rules for every agent** — which is more
robust than per-agent frontmatter hooks, because the Skill Curator can write to
`.claude/agents/` and could otherwise remove its own guard. Lura registers the guard both
ways for that reason.

> ⚠️ **Hooks are read when a session starts.** New agent definitions appear in the Agent
> tool listing mid-session, but hooks declared in them are **not** registered until the
> next session. This was verified: in a session started before the agents existed, the
> Implementer successfully wrote to `CLAUDE.md`; a fresh session denied the identical write
> with the guard's own message. Never conclude a hook is broken without retesting in a
> fresh session — and never conclude one works without testing it at all.

Beware one fail-open shape: this repository's path contains spaces and Cyrillic, and the
payload has been seen carrying a differently-encoded project prefix. `path.relative()` then
reports "outside", which denies correctly for `--only` but would **allow** for `--except`.
The guard also matches guarded names as path segments, which survives prefix mangling
because `.claude` and `CLAUDE.md` are ASCII.

## Skill files — `.claude/skills/<name>/SKILL.md`

Supported frontmatter: `name`, `description`, `allowed-tools`, `disallowed-tools`,
`argument-hint`, `arguments`, `when_to_use`, `version`, `model`, `effort`,
`disable-model-invocation`, `user-invocable`, `hooks`, `context`, `paths`.

Lura's skills use only `name` and `description`. `description` is the trigger — it decides
when the skill loads, so it must name the concrete situations, not the topic in general.

**Claude Code 2.1.191 does not read `.agents/` at all** — only `.claude/skills`,
`~/.claude/skills` and plugins. The vendored packs in `.agents/skills/` are inert for
Claude and belong to other tooling.

## When a skill is justified

Create or update one only when at least one holds:

- the knowledge is needed repeatedly;
- violating it creates substantial risk;
- it is project-specific and not obvious from nearby code;
- several agents need the same knowledge;
- it states an important project invariant.

Otherwise it belongs in the code, a comment, or `CLAUDE.md`. Every loaded skill costs
context on every use.

## Rules for Lura skills

- One domain per skill. No overlap with a sibling.
- Every rule traces to a file in this repository, and says which file.
- No generic tutorial content — the model already knows what FastAPI is.
- **No instruction to browse the web, fetch remote documentation, or call an MCP server.**
  The vendored `supabase` skill opens by telling the agent to fetch
  `https://supabase.com/changelog.md`; that is precisely what these skills must not do.
- No secrets, keys or `.env` values.
- Never create an empty placeholder skill.
- Verify against the files before asserting. A confidently wrong skill is worse than none,
  because agents trust it.

## After editing

There is no offline validator for these files. Check by hand: frontmatter parses as YAML,
`name` matches the directory or filename, no field outside the lists above, and every
factual claim still matches the repository.
