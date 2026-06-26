import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The agent-safe skill, embedded so it ships with the npm package and can be
// dropped into the user's global Claude skills dir by `lockit install`.
// Double-quoted JS lines so backticks in the markdown stay literal.
const SKILL_MD = [
  "---",
  "name: lockit-agent-safe",
  "description: Use lockit to discover, admit, and use developer secrets without ever seeing or printing a value. Use whenever you need API keys, .env values, database URLs, tokens, or any credential.",
  "---",
  "",
  "# Using lockit safely",
  "",
  "lockit is a local-first secrets manager. Drive it by NAMES ONLY. lockit (the shell) writes the actual values; you only ever pass names. Never print, echo, or `cat` a secret value or a populated `.env`. You see names, slugs, and `hasValue`; you never need the value.",
  "",
  "## Discover (value-free, always safe)",
  "- `lockit status` — the current project's admitted keys (names only).",
  "- `lockit ls` / `lockit ls --vars` — global stored secrets: names + structure, never values.",
  "- `lockit help` — the full command reference; read it if unsure.",
  "",
  "## Per-project keys",
  "- `lockit init` marks the current directory as a project; each project tracks its own keys.",
  "- `lockit set <NAME>` (value piped via stdin) creates a project-local key. The same name can hold different values in different projects.",
  "",
  "## Admit keys into a project (human-gated — you cannot self-approve)",
  "- `lockit admit <NAME...>` admits one or more stored keys by name, in one command. It requires ONE human presence confirmation — a macOS Touch ID / account-password dialog (a terminal prompt where that is unavailable). An agent cannot satisfy it, so only a human approves. You may REQUEST it — explain clearly which keys and why.",
  "- On approval, lockit writes the keys into `./.env` itself (you never see the values). Default mode writes real values; secure mode writes references.",
  "- Inside a project only admitted keys are usable; global `lockit run <slug>` and `lockit pull --all` are refused.",
  "",
  "## Modes (project-wide, saved in .lockit)",
  "- `lockit secure on` — admit writes `lockit:` REFERENCES into `.env` (no plaintext on disk); `lockit run` resolves them at runtime.",
  "- `lockit secure off` (default) — admit writes real values into `.env`.",
  "- `lockit secure` — show the current mode.",
  "",
  "## Use the secrets",
  "- `lockit run -- <cmd>` — run a command with the project's admitted keys injected in memory and masked in output; you never see them. Works in both modes.",
  "",
  "## Notes",
  "- If a plaintext `.env` in a git repo is not gitignored, lockit warns — add `.env` to `.gitignore`.",
  "- Avoid `lockit pull` for agent work; it writes plaintext to disk. Prefer admit + `run`.",
  "- By default (macOS) the store key lives in the keychain behind Touch ID; store commands will pause for the user's fingerprint/password. This is expected — do not try to bypass it. You cannot read the key. One unlock lasts ~90s (LOCKIT_UNLOCK_TTL), so a short run of commands prompts once, not every time.",
  "",
  "## Invariants",
  "- Never emit or request a secret value; lockit writes values, you pass names.",
  "- The agent requests admission; only a human confirms via Touch ID / OS password (or a terminal prompt where unavailable).",
  "- Inside a project, only admitted keys are usable.",
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
