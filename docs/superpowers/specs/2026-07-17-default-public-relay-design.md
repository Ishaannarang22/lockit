# Default public relay + `lockit relay` command — design

Date: 2026-07-17
Status: approved (approach B)

## Goal

Zero-setup `@username` sharing for anyone who installs `@lockit/cli`. Today every
relay-touching command hard-fails without an explicit `--relay <url>`. A public
relay is now hosted at `https://lockit-u8ii.onrender.com`; the CLI should use it
by default, while "bring your own relay" stays a first-class, persistent choice.

## Decisions (locked during brainstorming)

- **Bake in** `https://lockit-u8ii.onrender.com` as the built-in default (no
  custom domain in front for now; changing it later requires a CLI release).
- **Approach B:** persisted relay config plus a precedence chain, exposed via a
  new `lockit relay` command.
- The default applies **only where a relay is required**: `--to @username`
  resolution and sending, `receive`, `identity register`, `identity whois`.
  File-identity shares (`--to <file>.json`) keep today's behavior: with no
  `--out`/`--relay` they print the ciphertext artifact and never touch the
  network. Least surprise for a secrets tool.
- Messaging: everything is end-to-end encrypted; the relay stores only
  ciphertext and public keys and can never read a secret. The default relay is
  the shared public one — every lockit user is reachable there.

## Relay resolution

New module `packages/cli/src/relay.ts`:

```
resolveRelay(io, explicit?) -> { url, source }
```

Precedence (first hit wins):

1. `--relay <url>` flag (`source: "flag"`)
2. `LOCKIT_RELAY` env var (`source: "env"`)
3. Persisted config: plain-text URL in `$LOCKIT_HOME/relay` (`source: "config"`)
4. Built-in `DEFAULT_RELAY = "https://lockit-u8ii.onrender.com"` (`source: "default"`)

The config file is value-free (a public URL), so it lives beside `store.json`
as plain text, not inside the encrypted store. URLs are validated on write and
on read: must parse as `http:` or `https:`. A malformed configured URL is a
hard error naming the file, never a silent fall-through.

## `lockit relay` command

- `lockit relay` — print the active relay and where it came from, e.g.
  `https://lockit-u8ii.onrender.com (default)`.
- `lockit relay set <url>` — validate and persist to `$LOCKIT_HOME/relay`.
- `lockit relay reset` — delete the config file, returning to the default.

No secret material is involved, so no store unlock and no Touch ID.

## Command behavior changes

- `share <slug> --to @user` — `--relay` now optional; resolved relay is used
  for username lookup and message delivery. Success output names the relay
  host: `sent encrypted share <id> to @user via <host>`.
- `share <slug> --to @user --out <file>` with no explicit `--relay` — the
  resolved relay is used for the username lookup only; the artifact is written
  to the file and **not** posted (`--out` means file delivery). Passing
  `--relay` explicitly alongside `--out` does both, as today.
- `share <slug> --to <file>.json` — unchanged unless `--relay` is passed
  explicitly (then it posts, as today).
- `receive` — `--relay` optional; output becomes
  `received N shares via <host>`.
- `identity register <name>` / `identity whois <name>` — `--relay` optional.
- All parse loops keep rejecting unknown flags; usage strings show
  `[--relay <url>]` as optional.

## Docs and messaging

- `help.ts`: update the four usage entries, the share example (drop the local
  relay URL), and add a short paragraph: default public relay, E2E encryption,
  `lockit relay set` / `LOCKIT_RELAY` / `--relay` overrides, and the honest
  note that the free-tier relay may take up to a minute to wake from idle.
- `skill.ts` (agent-facing skill): `--relay` now optional, defaults to the
  public relay.
- `README.md` / docs: mention the default public relay wherever sharing is
  described.
- Honest-limits note (threat-model territory): the relay maps usernames to
  public keys, so a malicious or compromised relay could serve a wrong key.
  Verify a new correspondent's identity id out-of-band (`identity whois`
  prints it; `share` prints the recipient label). Document, never hide.

## Testing

TDD, colocated vitest files:

- `relay.test.ts` — precedence chain (flag > env > config > default), URL
  validation, `relay` show/set/reset round-trip against a temp `LOCKIT_HOME`.
- Share-path tests with a stubbed global `fetch` — `@username` share with no
  `--relay` hits the default relay; file-identity share with no flags performs
  zero fetches and prints the artifact; `receive` with no `--relay` uses the
  resolved relay; `LOCKIT_RELAY` env overrides the default end-to-end.

## Release

Minor version bump for `@lockit/cli` (new command + new default behavior,
backwards compatible: every existing invocation still works). `pnpm publish`
only (never `npm publish`).

## Rejected alternatives

- **Env var only** — "bring your own relay" would mean editing shell profiles;
  weak product story, and agent subprocesses may not inherit it.
- **Remote discovery manifest** — a moving part that can break every install;
  exactly the indirection declined when choosing to bake in the Render URL.
