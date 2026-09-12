#!/usr/bin/env node
/**
 * PreToolUse write-scope guard for Lura's developer agents.
 *
 * Claude Code 2.1.191 restricts an agent's *tools* in frontmatter but not the *paths*
 * those tools may write to, and `permissions.allow`/`deny` in settings.json are
 * session-global rather than per-agent. This hook supplies the missing per-agent
 * boundary, keyed on `agent_type` from the PreToolUse payload.
 *
 * Registered twice on purpose:
 *   1. In .claude/settings.json with no arguments — the authoritative registration.
 *      It covers every agent from one place that does not depend on any agent file
 *      still carrying a hook of its own.
 *   2. In a write-capable agent's frontmatter with explicit --only/--except arguments,
 *      as defence in depth. Stripping one layer leaves the other standing.
 *
 *   --only <prefix>    deny any write outside <prefix>
 *   --except <prefix>  deny any write inside <prefix>
 *
 * Both are repo-relative and repeatable. With no arguments the POLICY table applies.
 *
 * Contract: PreToolUse JSON on stdin, a deny decision on stdout, exit 0 either way —
 * the decision travels in the JSON, not the status code.
 */
import path from "node:path";

const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

/**
 * Shell is a write tool too, and the Edit/Write guard cannot see it.
 *
 * `sed -i`, `> file`, `python -c "open(...).write(...)"`, `Set-Content` all reach the
 * control plane while `tool_name` says "Bash". Trying to recognise *which* commands
 * write is the losing version of this problem — a filter that catches `sed -i` and
 * misses `Set-Content` is worse than none, because it gets trusted.
 *
 * So this does not try. A restricted agent has no legitimate reason to NAME a
 * governance file in a shell command at all: reading one is what the Read tool is for.
 * Denying the mention is blunt, over-denies rather than under-denies, and has no
 * bypass to find — which is the opposite failure mode from pattern-matching writes.
 */
const SHELL_TOOLS = ["Bash"];

/** Lower-cased because Windows paths are case-insensitive and so is this check. */
const GOVERNANCE_TOKENS = [".claude", "claude.md", ".mcp.json", "skills-lock.json"];

/**
 * The control plane: files that decide what agents may do.
 *
 * An agent able to edit these could rewrite the rules it runs under, so every
 * restricted agent is kept out of all of them. `.mcp.json` and `skills-lock.json`
 * belong here for the same reason as `.claude/` — one re-enables a remote MCP
 * server, the other decides which vendor skills get installed.
 */
const GOVERNANCE = [".claude", "CLAUDE.md", ".mcp.json", "skills-lock.json"];

/**
 * Governance paths that sit OUTSIDE the skill-curator's own area.
 *
 * The curator's `only` root already denies each of these, so this list is
 * belt-and-braces: if the root is ever widened, the control plane stays shut.
 * `.claude/skills` is deliberately absent — that is the curator's actual job.
 */
const GOVERNANCE_BEYOND_SKILLS = [
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".claude/hooks",
  ".claude/agents",
  "CLAUDE.md",
  ".mcp.json",
  "skills-lock.json",
];

/** Writes nothing, ever. Used for agents whose role is read-only. */
const READ_ONLY = { mode: "none" };

/** Writes product code, but never the control plane. */
const PRODUCT_ONLY = { mode: "except", paths: GOVERNANCE };

const POLICY = {
  // The only agent that writes application source.
  implementer: PRODUCT_ONLY,

  // Maintains the project skill library and nothing else. Cannot reach its own
  // tool list, the hook that restrains it, the settings, or the orchestration policy.
  "skill-curator": {
    mode: "only",
    roots: [".claude/skills"],
    except: GOVERNANCE_BEYOND_SKILLS,
  },

  // Read-only by role. Most of these also have no Edit/Write tool at all; the entry
  // is the second layer, so a future frontmatter edit cannot silently grant writes.
  architect: READ_ONLY,
  debugger: READ_ONLY,
  reviewer: READ_ONLY,
  "security-auditor": READ_ONLY,
  tester: READ_ONLY,
  "independent-advisor": READ_ONLY,
};

/**
 * Any agent this table does not name still cannot touch the control plane.
 *
 * Built-in agents (general-purpose, Explore, Plan, …) legitimately write product
 * files, so defaulting them to READ_ONLY would break ordinary work. Defaulting them
 * to PRODUCT_ONLY keeps the escalation path shut without that cost.
 */
const UNKNOWN_AGENT = PRODUCT_ONLY;

// String.fromCharCode(92) is a backslash; writing it literally here has proven
// fragile through the shell heredocs used to generate this file.
const BACKSLASH = String.fromCharCode(92);

function parseArgs(argv) {
  const roots = [];
  const except = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only" && argv[i + 1]) roots.push(argv[++i]);
    else if (argv[i] === "--except" && argv[i + 1]) except.push(argv[++i]);
  }
  if (roots.length > 0) return { mode: "only", roots, except };
  if (except.length > 0) return { mode: "except", paths: except };
  return null;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function splitPath(value) {
  return value.split(BACKSLASH).join("/").split("/").filter(Boolean);
}

/**
 * Segment-level match against the RAW, unnormalised target.
 *
 * This exists only as a fail-CLOSED fallback for the deny direction. The repository
 * path contains spaces and Cyrillic, and the payload has been observed carrying a
 * differently-encoded project prefix; when that prefix does not match,
 * path.relative() reports "outside", which would let a denied path through. The
 * guarded names are ASCII, so matching them as segments survives prefix mangling.
 *
 * It must NEVER be used to grant access. Against a raw path, `.claude/skills/../..`
 * still contains the segments `.claude` and `skills`, so using this to satisfy an
 * `only` root would hand back exactly the traversal escape the resolver prevents.
 * Deny-only is the invariant that makes it safe.
 */
function matchesSegment(prefix, target) {
  const segments = splitPath(target);
  const wanted = splitPath(prefix);
  if (wanted.length === 0) return false;
  for (let i = 0; i + wanted.length <= segments.length; i += 1) {
    if (wanted.every((w, j) => segments[i + j] === w)) return true;
  }
  return false;
}

function denyInside(paths, projectDir, resolved, rawTarget) {
  for (const p of paths) {
    if (isInside(path.resolve(projectDir, p), resolved) || matchesSegment(p, rawTarget)) return p;
  }
  return null;
}

function decide(payload, override) {
  const toolName = payload.tool_name ?? "";
  const isShell = SHELL_TOOLS.includes(toolName);
  if (!WRITE_TOOLS.includes(toolName) && !isShell) return null;

  /* Absent means the main session; present-but-unusable means a subagent whose identity
     could not be read. Those must not collapse into the same branch: treating a garbled
     agent_type as "no agent" would hand it the unsandboxed main-session path. */
  const declaresAgent = payload.agent_type !== undefined && payload.agent_type !== null;
  const agentType =
    typeof payload.agent_type === "string" && payload.agent_type.length > 0
      ? payload.agent_type
      : null;

  /* No override and no agent field at all: the main session acting as System
     Orchestrator. Claude Code offers no way to sandbox the main session, so that is a
     documented policy-level boundary rather than a technical one — see CLAUDE.md. */
  const rules =
    override ??
    (agentType ? (POLICY[agentType] ?? UNKNOWN_AGENT) : declaresAgent ? UNKNOWN_AGENT : null);
  if (!rules) return null;

  const who = agentType ?? "this agent";

  if (isShell) {
    /* Every restricted agent gets the same shell rule regardless of its write mode:
       naming the control plane in a command is refused. The main session was already
       returned above, so this never blocks orchestration. */
    const command = payload.tool_input?.command;
    if (typeof command !== "string") {
      return `${who}: Bash was called without a readable command, so its scope could not be verified.`;
    }
    const lowered = command.toLowerCase();
    const named = GOVERNANCE_TOKENS.find((token) => lowered.includes(token));
    if (named) {
      return (
        `${who} may not name governance configuration in a shell command (found "${named}"). ` +
        `The shell can write any file, so the control plane is off-limits to it entirely — ` +
        `use the Read tool to inspect these files, and escalate if one needs to change.`
      );
    }
    return null;
  }

  if (rules.mode === "none") {
    return (
      `${who} is a read-only agent and may not write any file. Blocked ${toolName}. ` +
      `Report what needs to change and let the implementer make the change.`
    );
  }

  const input = payload.tool_input ?? {};
  const rawTarget = input.file_path ?? input.notebook_path ?? input.path;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  if (typeof rawTarget !== "string" || rawTarget.length === 0) {
    return `${who}: ${toolName} was called without a resolvable file path, so its write scope could not be verified.`;
  }

  const resolved = path.resolve(projectDir, rawTarget);

  if (rules.mode === "only") {
    /* Resolver only — deliberately NOT matchesSegment. See its comment: a raw-segment
       match here would let `.claude/skills/../../apps` satisfy a `.claude/skills` root.
       If the project prefix is mangled, isInside reports "outside" and this denies,
       which is the correct direction to fail. */
    const inScope = rules.roots.some((p) => isInside(path.resolve(projectDir, p), resolved));
    if (!inScope) {
      return (
        `${who} may only write under ${rules.roots.join(" or ")}. Blocked ${toolName} on "${rawTarget}". ` +
        `Report the change that is needed instead of making it — another agent owns that area.`
      );
    }
    const hit = denyInside(rules.except ?? [], projectDir, resolved, rawTarget);
    if (hit) {
      return (
        `${who} may not write ${hit}: it is governance configuration, and an agent that ` +
        `can edit it can rewrite the rules it runs under. Blocked ${toolName} on "${rawTarget}".`
      );
    }
    return null;
  }

  const hit = denyInside(rules.paths, projectDir, resolved, rawTarget);
  if (hit) {
    return (
      `${who} may not write under ${hit}: that is the agent control plane, and changing it ` +
      `here would let an agent rewrite the rules it runs under. Blocked ${toolName} on ` +
      `"${rawTarget}". Governance changes need explicit user approval.`
    );
  }

  return null;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let reason;
  try {
    reason = decide(JSON.parse(raw), parseArgs(process.argv.slice(2)));
  } catch (error) {
    // A payload whose scope cannot be verified is a payload that does not get written.
    reason = `write-scope guard could not parse the hook payload (${error.message}), so the write was refused.`;
  }
  if (reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      })
    );
  }
  process.exit(0);
});
