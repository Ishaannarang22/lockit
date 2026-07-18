import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The agent-safe skill, embedded so it ships with the npm package and can be
// dropped into the user's global Claude skills dir by `lockit install`.
// Double-quoted JS lines so backticks in the markdown stay literal.
const SKILL_MD = [
  "---",
  "name: lockit-agent-safe",
  "description: Use lockit to discover, admit, share, receive, and run with developer secrets without ever seeing or printing a value. Use whenever you need API keys, .env values, database URLs, tokens, encrypted secret sharing, or any credential.",
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
  "## Share secrets end-to-end encrypted",
  "- `lockit identity [--out <file>]` — create or show this device's PUBLIC sharing identity. It is public key material only; private sharing keys stay sealed in LOCKIT_HOME.",
  "- `lockit identity register <username> [--relay <url>]` — register this public identity on a relay. The relay stores public keys only.",
  "- `lockit identity whois <username> [--relay <url>]` — resolve a username to a public identity id, value-free.",
  "- `lockit share <slug> --to <public-identity.json|@username> [--out <file>] [--relay <url>]` — encrypt and sign a point-in-time copy of one stored secret for a recipient. `@username` sends via the relay; a file identity with no flags prints a ciphertext artifact, never plaintext.",
  "- `lockit accept <share-file> [--as <slug>]` — decrypt an encrypted share addressed to this device and create a new local copy. Existing slugs are never overwritten; lockit suffixes instead.",
  "- `lockit receive [--relay <url>]` — fetch encrypted shares addressed to this device from the relay, accept each one, and delete accepted relay messages.",
  "- `lockit relay [set <url> | reset]` — show or change the relay in use. Relay commands default to the shared public relay (everyone on lockit is reachable there); precedence is `--relay` flag, then LOCKIT_RELAY, then `relay set`, then the public default. The public relay sleeps when idle and can take up to a minute to wake.",
  "- Sharing artifacts and relay messages are ciphertext. The relay cannot decrypt, but it can see metadata such as usernames, recipient identity ids, timing, and message sizes.",
  "- A share is a point-in-time copy. Later rotation of the sender's secret does not auto-propagate; re-share after rotation when the recipient needs the new value.",
  "- Receiving a share only adds it to the local global store. To use it in a project, request `lockit admit <slug>` and let the human approve.",
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
  "- Sharing uses public identities and ciphertext artifacts only; never ask for, print, or inspect a private identity or secret value.",
  "",
].join("\n");

/** The global Claude skills directory for lockit's agent-safe skill. */
export function skillDir(home: string): string {
  return claudeSkillDir(home);
}

export function claudeSkillDir(home: string): string {
  return join(home, ".claude", "skills", "lockit-agent-safe");
}

export function codexSkillDir(home: string): string {
  return join(home, ".codex", "skills", "lockit-agent-safe");
}

function writeSkill(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, SKILL_MD);
  return path;
}

/** Write the agent-safe skill into the user's global Claude skills dir so every
 *  repo's Claude knows how to use lockit. Returns the written path. */
export function installSkill(home: string): string {
  return writeSkill(claudeSkillDir(home));
}

/** Write the same skill into Codex's global skills dir. */
export function installCodexSkill(home: string): string {
  return writeSkill(codexSkillDir(home));
}

/** Bring previously installed skills up to date with this CLI version. Only
 *  touches skills the user already has (running `lockit install` is the opt-in;
 *  absence stays absent). Swallows filesystem errors — a broken skills dir must
 *  never break a lockit command. Returns the paths it rewrote. */
export function refreshInstalledSkills(home: string): string[] {
  const refreshed: string[] = [];
  for (const dir of [claudeSkillDir(home), codexSkillDir(home)]) {
    try {
      const path = join(dir, "SKILL.md");
      if (!existsSync(path)) continue;
      if (readFileSync(path, "utf8") === SKILL_MD) continue;
      writeFileSync(path, SKILL_MD);
      refreshed.push(path);
    } catch {
      // e.g. unreadable file or SKILL.md is a directory — leave it alone.
    }
  }
  return refreshed;
}
