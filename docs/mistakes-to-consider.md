# Mistakes to consider

Hard-won gotchas that have actually bitten us. Read before doing the matching task.

---

## Publishing to npm — ALWAYS use `pnpm publish`, NEVER `npm publish`

**The mistake (happened on `@lockit/cli@0.4.5`):** publishing with `npm publish`.

This is a **pnpm monorepo**. Packages depend on each other through the workspace
protocol, e.g. `@lockit/cli`'s `package.json` has:

```json
"dependencies": { "@lockit/core": "workspace:*" }
```

- `pnpm publish` **rewrites** `workspace:*` to the real version (`"@lockit/core": "0.4.3"`)
  at pack time.
- `npm publish` does **not** understand `workspace:` and ships the literal string.

A package published with `npm publish` therefore installs as:

```
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
```

i.e. **every install / `npx` of that version fails**. The broken version looks fine
in the publish output (`+ @lockit/cli@0.4.5`) — the failure only appears when a user
tries to install it.

### Correct release procedure

```sh
# 1. bump the version in the package's package.json (conventional commit)
# 2. make the gates green first
pnpm -r typecheck && pnpm lint && pnpm test && pnpm -r build

# 3. load the npm token, then publish WITH PNPM (rewrites workspace:*)
set -a; . ./.env; set +a          # NPM_TOKEN -> consumed by root .npmrc (${NPM_TOKEN})
pnpm --filter @lockit/cli publish --no-git-checks
```

- Run from the **repo root** so the root `.npmrc` (which maps `${NPM_TOKEN}` to the
  registry) is read. `pnpm --filter <pkg>` targets the package from the root.
- `--no-git-checks` is needed because release commits often sit on a feature branch;
  drop it if you want pnpm to enforce a clean, publishable tree.

### Two related traps in the same area

- **`.npmrc` is read from the cwd, not walked up the tree (for npm).** Running
  `cd packages/cli && npm publish` ignores the **root** `.npmrc`, so the
  `${NPM_TOKEN}` auth is never applied. npm then returns a misleading **`404 Not Found`**
  on a scoped package (it hides "no auth / no access" as a 404). `pnpm --filter` from
  the root avoids this.
- **Package name vs binary name.** Users install the scoped package `@lockit/cli` and
  get the `lockit` binary. `npx lockit` resolves a *different*, unscoped `lockit`
  package — not ours. Document `npm i -g @lockit/cli` + `lockit`, never `npx lockit`.

### Always verify after publishing

```sh
# dependencies must show a REAL version, never "workspace:*"
curl -s https://registry.npmjs.org/@lockit/cli/<version> \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).dependencies))"

# and prove it actually installs from the registry
TMP=$(mktemp -d); cd "$TMP" && npm init -y >/dev/null && npm install @lockit/cli@<version> \
  && ./node_modules/.bin/lockit help | head -1; rm -rf "$TMP"
```

### If you already shipped a broken version

You cannot re-publish the same version number. Instead:

```sh
# bump a patch, rebuild, and publish correctly with pnpm
pnpm --filter @lockit/cli publish --no-git-checks
# then deprecate the broken one so nobody installs it
npm deprecate @lockit/cli@<broken-version> "Broken: unresolved workspace: dependency; use <good-version>+"
```

(`npm unpublish @lockit/cli@<broken-version>` is also allowed within 72h if you want it
gone entirely, but deprecation is the safer default.)
