# Claude Code Plugin (skill + hooks) Implementation Plan (Intended)

> Status: INTENDED — scope-level. Expand into bite-sized failing-test-first TDD steps just-in-time, aligned with the repo state at that time. Plan #1 (docs/superpowers/plans/2026-06-17-p0-scaffold-and-crypto-foundations.md) is the worked example of the target granularity.

**Goal:** Ship the `plugin/` Claude Code plugin — a manifest, an agent-safe-usage skill, and a `PreToolUse` egress-guardrail hook — as a thin, unprivileged layer over the `lockit` CLI that teaches agents to *use* secrets via `lockit run` without ever seeing values, and warns/blocks before a raw secret is written into a file or command.

**Depends on:** Plan #5 (the `lockit` CLI: `run`, `status`, `list`, `link`, the admission flow, the chooser, `--dry-run`). The plugin is sugar over that binary and adds no privileged path. No MCP — see [ADR 0005](../../adr/0005-drop-mcp-cli-and-plugin.md).

**Packages touched:** `plugin/` (new top-level directory at the edge of the dependency graph; depends only on the `lockit` CLI invoked as a subprocess). No changes to `crypto`, `core`, or `server`. The hook is implemented as a small TypeScript module so it can be unit-tested with vitest under the existing workspace toolchain; whether it ships as its own `@lockit/plugin-hooks` workspace package or as plain scripts under `plugin/` is an expansion-time decision (see Open questions).

## Scope — what this subsystem builds

- **The plugin manifest** (`.claude-plugin/plugin.json`): a valid Claude Code plugin descriptor naming the plugin, version, description, and registering the skill and the `PreToolUse` hook. It declares no MCP server.
- **The agent-safe-usage skill**: a `SKILL.md` (plus frontmatter) that teaches an agent the correct mental model and workflow — `lockit` lets you *use* secrets without *seeing* them. It instructs the agent to: discover requirements with `lockit status` / `lockit list` / `lockit run --dry-run` (value-free), **request** admission (never assume it), understand that admission needs a human + local auth the agent cannot satisfy, and **run programs under `lockit run -- <cmd>`** rather than reading any value or copying it into a file, `.env`, or shell command.
- **The `PreToolUse` egress-guardrail hook**: intercepts file-writing and command-running tool calls before they execute, scans the proposed content/command for raw-secret patterns (known provider key shapes) and high-entropy strings, and **warns or blocks** when a real secret value appears to be on its way into a file or a command. This is the "make the invisible leaks visible" mitigation named in the threat model — not a containment guarantee.
- **Hook supporting logic**: a pure, testable secret-pattern detector (provider regexes + Shannon-entropy heuristic) and a thin adapter that maps Claude Code `PreToolUse` payloads to allow/warn/block decisions in the hook's expected output shape.
- **Content lints** that keep the skill honest and aligned with the canonical invariants (no instruction to ever read a value; always prefers `lockit run`; references the human-gated admission gate).

## Files / modules to create or modify — concrete paths + one-line responsibility each

- `plugin/.claude-plugin/plugin.json` — the plugin manifest: name, version, description, skill registration, `PreToolUse` hook registration; deliberately no MCP entry.
- `plugin/skills/agent-safe-lockit/SKILL.md` — the skill content: agent-safe `lockit` mental model, the request-admission flow, and the "use `lockit run`, never read the value" rule.
- `plugin/hooks/detect-secret.ts` — pure detector: `detectSecrets(text): SecretFinding[]` combining provider-shape regexes and a high-entropy-token heuristic. No I/O.
- `plugin/hooks/pre-tool-use.ts` — the hook entrypoint: reads a `PreToolUse` event, extracts the target file content or command string, runs `detectSecrets`, and emits the allow/warn/block decision in Claude Code's hook output shape.
- `plugin/hooks/pre-tool-use.bin.ts` (or a built JS shim) — the thin executable wrapper the manifest points at (reads stdin JSON, writes stdout JSON, sets exit code); keeps `pre-tool-use.ts` import-pure for tests.
- `plugin/hooks/detect-secret.test.ts` — unit tests for the detector (provider patterns + entropy).
- `plugin/hooks/pre-tool-use.test.ts` — unit tests for the event→decision mapping (file writes and command runs, allow/warn/block).
- `plugin/manifest.test.ts` — validates the manifest is well-formed JSON, has required fields, registers the skill and hook, and declares no MCP server.
- `plugin/skills/agent-safe-lockit/skill-content.test.ts` — content lints asserting the skill says the right things and never the wrong ones.
- `plugin/README.md` — short human-facing note: what the plugin is, that it is unprivileged sugar over the CLI, install instructions, and the honest egress-limit caveat.
- `plugin/package.json` / `plugin/tsconfig.json` — only if expansion chooses a workspace-package form for the hooks (see Open questions); otherwise the hook tests run under the root vitest config via an `include` addition.

## Key components & responsibilities

**Detector (`detect-secret.ts`).** Pure function over a string. Two complementary strategies, both returning structured findings (never the matched value itself in any persisted output):

```ts
type SecretKind = "provider-pattern" | "high-entropy";
interface SecretFinding {
  kind: SecretKind;
  label: string;        // e.g. "openai-secret-key", "aws-access-key-id", "generic-high-entropy"
  start: number;        // offset in the scanned text (for redaction, not display of the value)
  length: number;
}
function detectSecrets(text: string): SecretFinding[];
```

Provider-pattern matching covers well-known shapes (e.g. OpenAI `sk-…`, AWS `AKIA…` access-key IDs, Slack `xox[baprs]-…`, GitHub `ghp_…`/`github_pat_…`, Stripe `sk_live_…`, Google API keys, private-key PEM headers, generic `bearer <token>` / `Authorization:` headers). The entropy heuristic flags long base64/hex-ish tokens whose Shannon entropy exceeds a threshold and whose length passes a floor, to catch values that match no named provider. The detector errs toward surfacing findings (warn) and reserves blocking for high-confidence provider matches, to keep false-positive friction low (final warn/block policy split is an expansion-time tuning decision, see Open questions).

**Hook entrypoint (`pre-tool-use.ts`).** Maps a `PreToolUse` event to a decision. It must recognise the tool types that can exfiltrate: file-writing tools (Write/Edit and equivalents) and command-running tools (Bash and equivalents), extract the right field (file `content` / new string, or the `command` string), and run the detector. Output follows Claude Code's hook contract:

```ts
type Decision = "allow" | "warn" | "block";
interface HookResult {
  decision: Decision;
  reason?: string;      // value-free explanation naming the finding label(s) only
}
function evaluatePreToolUse(event: PreToolUseEvent): HookResult;
```

The reason string names only the finding *label* and a remediation hint ("looks like a raw secret is about to be written to `config.ts`; use `lockit run -- …` so the value is injected at runtime instead") — it never echoes the matched secret. The executable wrapper handles stdin/stdout/exit-code plumbing and stays a thin shell so the decision logic is unit-testable in isolation.

**Skill (`SKILL.md`).** Prose + frontmatter teaching the agent: the agent never sees values; discover requirements value-free; request admission and wait for the human to confirm with local auth; run everything under `lockit run -- <cmd>`; never paste a value into a file/`.env`/command; treat an `AMBIGUOUS` chooser as a question for the human, not something to guess. It must point at the CLI as the only interface and explicitly note the plugin adds no privileged access.

**Manifest (`plugin.json`).** The single source of truth Claude Code reads to load the skill and hook. It registers the `PreToolUse` hook against the file-write and command-run tool matchers and registers the skill directory. It contains no MCP server declaration, by design.

## Tests that prove it — emphasizing security properties

- **Provider-pattern detection:** given strings containing real-shaped tokens for each supported provider (OpenAI `sk-`, AWS `AKIA`, GitHub `ghp_`, Slack `xox*`, Stripe `sk_live_`, a PEM `-----BEGIN … PRIVATE KEY-----` header), `detectSecrets` returns a finding with the correct label for each — proving the egress guardrail recognises known raw-secret shapes.
- **High-entropy detection:** a long random base64/hex token that matches no provider pattern is flagged as `generic-high-entropy`, while ordinary prose, code identifiers, file paths, and common low-entropy strings are **not** flagged — proving the entropy heuristic catches unknown secrets without drowning in false positives.
- **Detector never leaks the value:** every `SecretFinding` (and any reason string built from it) contains only a label/offset, never the matched substring — proving the guardrail itself cannot become an exfiltration channel.
- **File-write egress is caught:** a `PreToolUse` event for a Write/Edit whose content contains a raw secret yields a `block` (or `warn`) decision, with a value-free reason that recommends `lockit run` — proving a raw secret on its way into a file is intercepted.
- **Command egress is caught:** a `PreToolUse` event for a Bash command embedding a raw secret (e.g. `curl -H "Authorization: Bearer sk-…"`, or `echo sk-… >> .env`) yields a non-allow decision — proving a raw secret on its way into a command is intercepted.
- **Clean input passes:** a `PreToolUse` event whose content is `lockit run -- npm start` or otherwise contains no secret yields `allow` with no false positive — proving the guardrail does not block the *correct* agent-safe workflow.
- **`lockit run` invocations are never flagged:** a command that uses `lockit run -- …` (the sanctioned path, where the value is injected at runtime and never present in the command text) is allowed — proving the hook rewards the safe pattern rather than punishing it.
- **Manifest validity:** `plugin.json` parses as JSON, has the required plugin fields, registers the `agent-safe-lockit` skill and the `PreToolUse` hook, points the hook at an existing entrypoint, and **declares no MCP server** — proving ADR 0005 is honored at the manifest level.
- **Skill content lint — uses `lockit run`, never reads values:** the skill text instructs the agent to run programs via `lockit run -- <cmd>` and contains no instruction to read, print, copy, cat, or echo a secret value; an assertion fails if any "read the value" pattern appears — proving the skill enforces the agent-never-sees-a-value invariant.
- **Skill content lint — human-gated admission:** the skill states that admission requires a human plus local auth and that the agent can only *request* it (never satisfy the gate) — proving the skill teaches the sandbox/admission boundary correctly.
- **Skill content lint — honest limit:** the skill (and README) state the honest containment limit (a using process holds the real value; the hook makes leaks visible, not impossible) rather than overclaiming — proving alignment with the threat model.
- **Unprivileged path:** a check that the skill and README describe the plugin as flowing entirely through the `lockit` binary with no privileged access — proving the plugin adds guardrails, not a bypass.

## Out of scope / deferred

- **MCP / any structured-tool transport.** Dropped from v1 per ADR 0005; the only later justification would be shell-less AI hosts, and it would be a thin adapter over `core`, not part of this plugin.
- **Network egress inspection / proxying.** The hook inspects the *proposed* tool call (file content, command string) before execution; it does not intercept actual outbound network traffic from a running child. Runtime exfiltration by a using process remains the documented honest limit.
- **Masking of child stdout/stderr and the audit log.** Those live in the CLI/`core` (Plan #5 and earlier) — the plugin relies on them, it does not reimplement them.
- **Editor/IDE integrations beyond the Claude Code plugin format.**
- **Auto-remediation** (rewriting a flagged Write into a `lockit run` invocation). The hook warns/blocks and advises; it does not silently edit the agent's action.

## Open questions

- **Workspace-package vs scripts:** should the hook ship as a `@lockit/plugin-hooks` workspace package (clean build/test boundary) or as plain TS/JS under `plugin/` wired into the root vitest `include`? Decide at expansion time based on how Claude Code resolves a hook executable path.
- **Warn vs block policy split:** which finding kinds hard-block (high-confidence provider matches) vs warn-and-allow (entropy heuristic), and is the threshold user-configurable via plugin settings?
- **Entropy threshold + length floor:** concrete values to balance recall against false positives on real codebases; needs a small corpus to tune.
- **Hook payload shape:** the exact `PreToolUse` event schema and the exact allow/warn/block output contract for the current Claude Code version — confirm against the live plugin docs at expansion time and pin a fixture.
- **Tool-name matching:** the canonical set of file-write and command-run tool names (and how to stay robust if new ones appear) for the hook matcher.
