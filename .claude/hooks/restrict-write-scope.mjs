#!/usr/bin/env node
/**
 * PreToolUse write-scope guard for Lura's developer agents.
 *
 * Claude Code 2.1.191 restricts an agent's *tools* in frontmatter but not the *paths*
 * those tools may write to, and permission rules in settings.json are session-global.
 * This hook supplies the missing per-agent path boundary.
 *
 * It runs in two registrations, deliberately:
 *
 *   1. From .claude/settings.json with no arguments. The policy is then looked up from
 *      `agent_type` in the hook payload. This registration is the authoritative one —
 *      it covers every agent from a single place that does not depend on any agent file
 *      still carrying its own hook.
 *   2. From an agent's own frontmatter with explicit --only/--except arguments, as
 *      defence in depth. Stripping one layer leaves the other standing, and the
 *      skill-curator can write to .claude/agents/, so one layer is not enough.
 *
 *   --only <prefix>    deny any write outside <prefix>
 *   --except <prefix>  deny any write inside <prefix>
 *
 * Both are repo-relative and repeatable. With no arguments the table below applies.
 *
 * Contract: PreToolUse JSON on stdin, a deny decision on stdout, exit 0 either way —
 * the decision travels in the JSON, not the status code.
 */
import path from "node:path";

const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

// Governance files. Any agent allowed to edit these could rewrite the approval gate
// it runs under, so only the skill-curator reaches them, and only via --only.
const GOVERNANCE = [".claude", "CLAUDE.md"];

const POLICY = {
  "skill-curator": { only: [".claude"], except: [] },
  implementer: { only: [], except: GOVERNANCE },
  tester: { only: [], except: GOVERNANCE },
  // These have no write tools at all; the entry is belt-and-braces in case that changes.
  architect: { only: [], except: GOVERNANCE },
  debugger: { only: [], except: GOVERNANCE },
  reviewer: { only: [], except: GOVERNANCE },
  "security-auditor": { only: [], except: GOVERNANCE },
  "independent-advisor": { only: ["\u0000never"], except: [] },
};

function parseArgs(argv) {
  const only = [];
  const except = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--only" && argv[i + 1]) only.push(argv[++i]);
    else if (argv[i] === "--except" && argv[i + 1]) except.push(argv[++i]);
  }
  return only.length || except.length ? { only, except } : null;
}

function isInside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Segment-level fallback for the --except direction.
 *
 * The repository path contains spaces and Cyrillic, and the payload has been observed
 * carrying a differently-encoded project prefix. If that prefix does not match,
 * path.relative() reports "outside", which is safe for --only (denies) but would fail
 * OPEN for --except. The guarded names are ASCII, so matching them as path segments
 * survives any mangling of the prefix ahead of them.
 */
// String.fromCharCode(92) is a backslash; writing it literally here has proven
// fragile through the shell heredocs used to generate this file.
const BACKSLASH = String.fromCharCode(92);

function splitPath(value) {
  return value.split(BACKSLASH).join("/").split("/").filter(Boolean);
}

function matchesSegment(prefix, target) {
  const segments = splitPath(target);
  const wanted = splitPath(prefix);
  if (wanted.length === 0) return false;
  for (let i = 0; i + wanted.length <= segments.length; i += 1) {
    if (wanted.every((w, j) => segments[i + j] === w)) return true;
  }
  return false;
}

function decide(payload, override) {
  const toolName = payload.tool_name ?? "";
  if (!WRITE_TOOLS.includes(toolName)) return null;

  const agentType = payload.agent_type ?? null;
  // No arguments and no known agent: this is the main session (the System Orchestrator),
  // which coordinates rather than being sandboxed. Agent-scoped rules do not apply.
  const rules = override ?? (agentType ? POLICY[agentType] : null);
  if (!rules) return null;

  const input = payload.tool_input ?? {};
  const target = input.file_path ?? input.notebook_path ?? input.path;
  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const who = agentType ? `${agentType}` : "this agent";

  if (!target) {
    return `${who}: ${toolName} was called without a resolvable file path, so its write scope could not be verified.`;
  }

  const resolved = path.resolve(projectDir, target);

  if (rules.only.length > 0) {
    const ok = rules.only.some(
      (p) => isInside(path.resolve(projectDir, p), resolved) || matchesSegment(p, target)
    );
    if (!ok) {
      return (
        `${who} may only write under ${rules.only.join(" or ")}. Blocked ${toolName} on "${target}". ` +
        `Report the change that is needed instead of making it — another agent owns that area.`
      );
    }
  }

  for (const p of rules.except) {
    if (isInside(path.resolve(projectDir, p), resolved) || matchesSegment(p, target)) {
      return (
        `${who} may not write under ${p}. Blocked ${toolName} on "${target}". ` +
        `Agent and skill configuration is the skill-curator's area, and changing it here ` +
        `would let an agent rewrite the rules it runs under. Escalate instead.`
      );
    }
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
