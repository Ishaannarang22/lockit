import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The agent-safe skill, embedded so it ships with the npm package and can be
// dropped into the user's global Claude skills dir by `lockit install`.
// Double-quoted JS lines so backticks in the markdown stay literal.
const SKILL_MD = [
  "---",
  "name: lockit-agent-safe",
  "description: Use lockit to discover, use, and request developer secrets without ever seeing or printing a value. Use whenever you need API keys, .env values, database URLs, tokens, or any credential.",
  "---",
  "",
  "# Using lockit safely",
  "",
  "lockit is a local-first secrets manager. Drive it by NAMES ONLY. Never request, print, or store a secret value — you work with names, slugs, and `hasValue` booleans; humans see values.",
  "",
  "## Discover (value-free, always safe)",
  "- `lockit status` — the current project's admitted keys (names only).",
  "- `lockit ls` / `lockit ls --vars` — global secrets: names + structure, never values.",
  "- `lockit help` — the full command reference; read it if unsure.",
  "",
  "## Use a secret WITHOUT seeing it",
  "- `lockit run -- <cmd>` — inside a project, inject the project's admitted keys into `<cmd>`. Values live in memory only and are masked in output; you never see them.",
  "- `lockit run <slug> -- <cmd>` — outside a project, inject one global secret.",
  "",
  "## Per-project keys",
  "- `lockit init` marks a directory as a project.",
  "- `lockit set <NAME>` (value piped via stdin) creates a project-local key. The same name can hold different values in different projects.",
  "",
  "## Request admission (human-gated — you cannot do this yourself)",
  "- `lockit admit <slug|slug#field> [--as NAME]` binds an existing/shared secret into the project.",
  "- You may only REQUEST it; a human must confirm on the terminal (an agent driving stdin cannot answer). Explain clearly what you are admitting and why.",
  "- Inside a project, only admitted keys are usable; global `run <slug>` is refused.",
  "",
  "## Avoid",
  "- `lockit pull` writes plaintext values to a file on disk. Prefer `lockit run`.",
  "",
  "## Invariants",
  "- Never emit or request a secret value.",
  "- `run` is safe; `pull` is not.",
  "- Admission needs a human; the agent only asks.",
  "",
].join("\n");

/** The global Claude skills directory for lockit's agent-safe skill. */
export function skillDir(home: string): string {
  return join(home, ".claude", "skills", "lockit-agent-safe");
}

/** Write the agent-safe skill into the user's global Claude skills dir so every
 *  repo's Claude knows how to use lockit. Returns the written path. */
export function installSkill(home: string): string {
  const dir = skillDir(home);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, SKILL_MD);
  return path;
}
