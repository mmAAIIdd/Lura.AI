#!/usr/bin/env node
/**
 * Boundary tests for restrict-write-scope.mjs.
 *
 *   node .claude/hooks/restrict-write-scope.test.mjs
 *
 * Run this after ANY change to the hook, the POLICY table, or an agent's tools.
 * It is the only thing that distinguishes a guard that denies from a guard that
 * merely looks like it denies — every case below was open at some point.
 *
 * Exit code 0 = all boundaries hold. Non-zero = a boundary is open.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "restrict-write-scope.mjs");
const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function run(payload, args = []) {
  const r = spawnSync(process.execPath, [HOOK, ...args], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8",
  });
  return r.stdout.trim().length > 0 ? "DENY" : "ALLOW";
}

const cases = [];
const write = (agent, file, tool = "Write") => ({
  cwd: ROOT,
  agent_type: agent,
  tool_name: tool,
  tool_input: { file_path: file },
});
const abs = (p) => path.join(ROOT, p);
const c = (expect, name, payload, args) => cases.push({ expect, name, payload, args });

/* --- implementer: product code yes, control plane no --- */
c("ALLOW", "implementer -> apps/api source", write("implementer", abs("apps/api/app/main.py"), "Edit"));
c("ALLOW", "implementer -> apps/web source", write("implementer", abs("apps/web/lib/x.ts")));
for (const g of [".claude/settings.json", ".claude/settings.local.json", "CLAUDE.md", ".mcp.json",
                 "skills-lock.json", ".claude/hooks/restrict-write-scope.mjs", ".claude/agents/implementer.md"]) {
  c("DENY", `implementer -> ${g}`, write("implementer", abs(g), "Edit"));
}

/* --- read-only agents: nothing at all --- */
for (const a of ["architect", "debugger", "reviewer", "security-auditor", "tester", "independent-advisor"]) {
  c("DENY", `${a} -> product code`, write(a, abs("apps/api/app/main.py")));
  c("DENY", `${a} -> CLAUDE.md`, write(a, abs("CLAUDE.md"), "Edit"));
}
c("DENY", "tester -> test file (writes nothing at all)", write("tester", abs("apps/api/tests/test_x.py")));

/* --- skill-curator: its own area only, never its own restraints --- */
c("ALLOW", "curator -> .claude/skills/**", write("skill-curator", abs(".claude/skills/x/SKILL.md")));
for (const g of [".claude/settings.json", ".claude/settings.local.json", ".claude/hooks/restrict-write-scope.mjs",
                 ".claude/agents/skill-curator.md", ".claude/agents/implementer.md", "CLAUDE.md",
                 ".mcp.json", "skills-lock.json", "apps/api/app/main.py"]) {
  c("DENY", `curator -> ${g}`, write("skill-curator", abs(g), "Edit"));
}

/* --- traversal: the escape that was open until the only-branch stopped
       trusting raw-segment matches --- */
for (const t of [".claude/skills/../../apps/api/app/main.py", ".claude/skills/../settings.json",
                 ".claude/skills/../hooks/restrict-write-scope.mjs", ".claude/skills/../agents/tester.md",
                 ".claude\\skills\\..\\settings.json"]) {
  c("DENY", `curator traversal -> ${t}`, write("skill-curator", t));
}
c("DENY", "implementer traversal -> apps/../CLAUDE.md", write("implementer", "apps/../CLAUDE.md", "Edit"));

/* --- case: Windows resolves these to the same files --- */
for (const t of [".Claude/settings.json", "claude.md", "CLAUDE.MD", ".MCP.json"]) {
  c("DENY", `implementer case variant -> ${t}`, write("implementer", abs(t), "Edit"));
}
c("ALLOW", "curator case variant inside own area", write("skill-curator", abs(".Claude/Skills/x/SKILL.md")));

/* --- unknown and malformed identities must never reach the control plane --- */
c("ALLOW", "unknown agent -> product code", write("general-purpose", abs("apps/web/x.ts")));
c("DENY", "unknown agent -> .claude/settings.json", write("general-purpose", abs(".claude/settings.json"), "Edit"));
c("DENY", "agent_type object -> governance", { cwd: ROOT, agent_type: { x: 1 }, tool_name: "Write", tool_input: { file_path: abs(".claude/settings.json") } });
c("DENY", "agent_type number -> governance", { cwd: ROOT, agent_type: 7, tool_name: "Write", tool_input: { file_path: abs(".mcp.json") } });
c("DENY", "agent_type empty string -> governance", { cwd: ROOT, agent_type: "", tool_name: "Write", tool_input: { file_path: abs("CLAUDE.md") } });

/* --- main session is deliberately unsandboxed: policy, not enforcement --- */
c("ALLOW", "main session (no agent_type) -> governance", { cwd: ROOT, tool_name: "Edit", tool_input: { file_path: abs(".claude/settings.json") } });

/* --- input robustness: unverifiable means denied --- */
c("ALLOW", "non-write tool passes through", write("tester", abs("CLAUDE.md"), "Read"));
c("ALLOW", "Bash is NOT intercepted (documented limitation)", { cwd: ROOT, agent_type: "implementer", tool_name: "Bash", tool_input: { command: "echo x > CLAUDE.md" } });
c("DENY", "write with no path", { cwd: ROOT, agent_type: "implementer", tool_name: "Write", tool_input: {} });
c("DENY", "malformed JSON payload", "not json at all");
c("DENY", "MultiEdit is intercepted", write("tester", abs("apps/api/app/main.py"), "MultiEdit"));
c("DENY", "NotebookEdit is intercepted", { cwd: ROOT, agent_type: "tester", tool_name: "NotebookEdit", tool_input: { notebook_path: abs("x.ipynb") } });

/* --- frontmatter override still works (defence in depth) --- */
c("DENY", "--only .claude/skills blocks apps/", write("skill-curator", abs("apps/x.ts")), ["--only", ".claude/skills"]);
c("DENY", "--except CLAUDE.md blocks it", write("implementer", abs("CLAUDE.md"), "Edit"), ["--except", "CLAUDE.md"]);

let failed = 0;
for (const { expect, name, payload, args } of cases) {
  const got = run(payload, args);
  if (got !== expect) {
    failed += 1;
    console.log(`FAIL  expected ${expect}, got ${got}  ${name}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} boundary cases hold`);
if (failed > 0) {
  console.log(`${failed} OPEN BOUNDARY(S) — do not rely on the guard until these pass.`);
  process.exit(1);
}
