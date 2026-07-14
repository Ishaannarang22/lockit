import { readFile, stat, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadStore, storePath } from "@lockit/core";
import { cmdLs, cmdRun, cmdSet, type Io } from "./commands.js";

const SECRET = "sk-super-secret-1234567890";
const PASSPHRASE = "correct horse battery staple";

interface Capture {
  out: string;
  err: string;
}

/** Build an Io whose out/err accumulate into a returned capture object. */
function makeIo(argv: string[], stdin: string, capture: Capture, env = process.env): Io {
  return {
    argv,
    stdin,
    env,
    out: (s) => {
      capture.out += s;
    },
    err: (s) => {
      capture.err += s;
    },
  };
}

/** Run a fresh capture through a handler and return both code and capture. */
async function run(
  handler: (io: Io) => Promise<number>,
  argv: string[],
  stdin = "",
  env = process.env,
): Promise<{ code: number; out: string; err: string }> {
  const cap: Capture = { out: "", err: "" };
  const code = await handler(makeIo(argv, stdin, cap, env));
  return { code, out: cap.out, err: cap.err };
}

describe("lockit cli commands", () => {
  let home: string;
  let prevHome: string | undefined;
  let prevPass: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "lockit-cli-"));
    prevHome = process.env.LOCKIT_HOME;
    prevPass = process.env.LOCKIT_PASSPHRASE;
    process.env.LOCKIT_HOME = home;
    process.env.LOCKIT_PASSPHRASE = PASSPHRASE;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.LOCKIT_HOME;
    else process.env.LOCKIT_HOME = prevHome;
    if (prevPass === undefined) delete process.env.LOCKIT_PASSPHRASE;
    else process.env.LOCKIT_PASSPHRASE = prevPass;
    await rm(home, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: value comes from stdin, never argv
  // ---------------------------------------------------------------------------
  describe("cmdSet — value comes from stdin, never argv", () => {
    it("stores the stdin value and prints a value-free confirmation", async () => {
      const set = await run(cmdSet, ["openai/dev", "OPENAI_API_KEY"], `${SECRET}\n`);
      expect(set.code).toBe(0);
      expect(set.out).toBe("set openai/dev OPENAI_API_KEY (env)\n");
      expect(set.out).not.toContain(SECRET);
      expect(set.err).toBe("");
    });

    it("ignores a value-shaped 3rd positional argv token (value is stdin only)", async () => {
      const set = await run(
        cmdSet,
        ["openai/dev", "OPENAI_API_KEY", "ARGV_SHOULD_BE_IGNORED"],
        `${SECRET}\n`,
      );
      expect(set.code).toBe(0);

      // Decrypt the store directly: the argv token is nowhere, the stdin value is.
      const store = await loadStore(PASSPHRASE, storePath());
      const field = store.secrets[0]?.fields[0];
      expect(field?.value).toBe(SECRET);
      expect(field?.value).not.toBe("ARGV_SHOULD_BE_IGNORED");

      // And the child injection proves the same value, masked in lockit's output.
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write(process.env.OPENAI_API_KEY ?? '')",
      ]);
      expect(r.out).not.toContain("ARGV_SHOULD_BE_IGNORED");
    });

    it("trims exactly one trailing LF", async () => {
      await run(cmdSet, ["openai/dev", "K"], "value\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("value");
    });

    it("trims exactly one trailing CRLF", async () => {
      await run(cmdSet, ["openai/dev", "K"], "value\r\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("value");
    });

    it("preserves a value with no trailing newline exactly", async () => {
      await run(cmdSet, ["openai/dev", "K"], "value");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("value");
    });

    it("trims only ONE trailing newline (a second newline is preserved)", async () => {
      await run(cmdSet, ["openai/dev", "K"], "value\n\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("value\n");
    });

    it("preserves inner newlines and special characters", async () => {
      const multi = "line1\nline2\t<>&='\"$`";
      await run(cmdSet, ["openai/dev", "K"], `${multi}\n`);
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe(multi);
    });

    it("accepts an empty value", async () => {
      const set = await run(cmdSet, ["openai/dev", "K"], "");
      expect(set.code).toBe(0);
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: required arguments and flags
  // ---------------------------------------------------------------------------
  describe("cmdSet — required arguments and flags", () => {
    it("rejects missing slug AND key (no args) with usage on stderr, exit 1", async () => {
      const set = await run(cmdSet, [], "v\n");
      expect(set.code).toBe(1);
      expect(set.err).toContain("usage: lockit set <slug> <KEY>");
      expect(set.out).toBe("");
    });

    it("one positional outside a project is rejected with a project hint", async () => {
      // A single positional means project-local set; with no .lockit/ ancestor
      // (the test cwd is not a project), it errors and points at init / global set.
      const set = await run(cmdSet, ["OPENAI_API_KEY"], "v\n");
      expect(set.code).toBe(1);
      expect(set.err).toContain("not in a lockit project");
    });

    it("--schema requires a following value (none provided) -> exit 1", async () => {
      const set = await run(cmdSet, ["openai/dev", "K", "--schema"], "v\n");
      expect(set.code).toBe(1);
      expect(set.err).toContain("--schema requires a non-empty value");
    });

    it("--schema with an empty-string value is rejected", async () => {
      const set = await run(cmdSet, ["openai/dev", "K", "--schema", ""], "v\n");
      expect(set.code).toBe(1);
      expect(set.err).toContain("--schema requires a non-empty value");
    });

    it("--file flag is recognized and sets the field type to file", async () => {
      const set = await run(cmdSet, ["openai/dev", "K", "--file"], "v\n");
      expect(set.code).toBe(0);
      expect(set.out).toBe("set openai/dev K (file)\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.fields[0]?.type).toBe("file");
    });

    it("--file can appear before the positionals", async () => {
      const set = await run(cmdSet, ["--file", "openai/dev", "K"], "v\n");
      expect(set.code).toBe(0);
      expect(set.out).toBe("set openai/dev K (file)\n");
    });

    it("--schema and --file can be combined", async () => {
      const set = await run(cmdSet, ["openai/dev", "K", "--schema", "custom", "--file"], "v\n");
      expect(set.code).toBe(0);
      expect(set.out).toBe("set openai/dev K (file)\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.schema).toBe("custom");
      expect(store.secrets[0]?.fields[0]?.type).toBe("file");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: slug validation (strict)
  // ---------------------------------------------------------------------------
  describe("cmdSet — slug validation", () => {
    it("accepts a valid single-segment slug", async () => {
      expect((await run(cmdSet, ["openai", "K"], "v\n")).code).toBe(0);
    });

    it("accepts a multi-segment slug a/b/c", async () => {
      const set = await run(cmdSet, ["a/b/c", "K"], "v\n");
      expect(set.code).toBe(0);
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.slug).toBe("a/b/c");
    });

    it("accepts a slug with . _ - in a segment", async () => {
      expect((await run(cmdSet, ["a.b_c-d/e", "K"], "v\n")).code).toBe(0);
    });

    for (const [label, slug] of [
      ["uppercase", "OpenAI/dev"],
      ["space", "open ai/dev"],
      ["leading slash", "/openai"],
      ["trailing slash", "openai/"],
      ["empty", ""],
      ["newline", "openai\n"],
      ["segment starting with non-alphanumeric", "openai/-dev"],
    ] as const) {
      it(`rejects an invalid slug (${label}) with exit 1 and 'invalid slug'`, async () => {
        const set = await run(cmdSet, [slug, "K"], `${SECRET}\n`);
        expect(set.code).toBe(1);
        expect(set.err).toContain("invalid slug");
        // The error never contains the secret value.
        expect(set.err).not.toContain(SECRET);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // cmdSet: field-key validation (env-var identifier)
  // ---------------------------------------------------------------------------
  describe("cmdSet — field key validation", () => {
    for (const [label, key] of [
      ["space", "MY KEY"],
      ["equals", "MY=KEY"],
      ["newline", "MY\nKEY"],
      ["empty", ""],
      ["leading digit", "1KEY"],
      ["hyphen", "MY-KEY"],
      ["dot", "MY.KEY"],
    ] as const) {
      it(`rejects an invalid field key (${label}) with 'invalid field key'`, async () => {
        const set = await run(cmdSet, ["openai/dev", key], "v\n");
        expect(set.code).toBe(1);
        expect(set.err).toContain("invalid field key");
      });
    }

    it("accepts a leading-underscore key and an all-caps key", async () => {
      expect((await run(cmdSet, ["openai/dev", "_PRIVATE"], "v\n")).code).toBe(0);
      expect((await run(cmdSet, ["openai/dev", "API_KEY_2"], "v\n")).code).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: schema resolution
  // ---------------------------------------------------------------------------
  describe("cmdSet — schema resolution", () => {
    it("defaults the schema to the first slug segment", async () => {
      await run(cmdSet, ["supabase/acme", "K"], "v\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.schema).toBe("supabase");
    });

    it("uses the whole slug as schema for a single-segment slug", async () => {
      await run(cmdSet, ["stripe", "K"], "v\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.schema).toBe("stripe");
    });

    it("an explicit --schema overrides the default", async () => {
      await run(cmdSet, ["supabase/acme", "K", "--schema", "postgres"], "v\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets[0]?.schema).toBe("postgres");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: encryption, persistence, upsert
  // ---------------------------------------------------------------------------
  describe("cmdSet — encryption and persistence", () => {
    it("writes no plaintext value to disk; the on-disk store is sealed JSON", async () => {
      await run(cmdSet, ["openai/dev", "OPENAI_API_KEY"], `${SECRET}\n`);
      const raw = await readFile(storePath(), "utf8");
      expect(raw).not.toContain(SECRET);
      expect(raw).not.toContain("OPENAI_API_KEY"); // key is part of sealed plaintext too
      const blob = JSON.parse(raw) as { v: number; kdf: { algo: string }; ciphertext: string };
      expect(blob.v).toBe(1);
      expect(blob.kdf.algo).toBe("argon2id");
      expect(typeof blob.ciphertext).toBe("string");
    });

    it("creates the store file with mode 0600", async () => {
      await run(cmdSet, ["openai/dev", "K"], "v\n");
      const st = await stat(storePath());
      expect(st.mode & 0o777).toBe(0o600);
    });

    it("a wrong passphrase cannot decrypt the store", async () => {
      await run(cmdSet, ["openai/dev", "K"], `${SECRET}\n`);
      await expect(loadStore("the-wrong-passphrase", storePath())).rejects.toThrow(
        /wrong passphrase or corrupted/,
      );
    });

    it("upsert replaces an existing field value (no duplicate field)", async () => {
      await run(cmdSet, ["openai/dev", "K"], "first\n");
      await run(cmdSet, ["openai/dev", "K"], "second\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets).toHaveLength(1);
      expect(store.secrets[0]?.fields).toHaveLength(1);
      expect(store.secrets[0]?.fields[0]?.value).toBe("second");
    });

    it("multiple fields on one secret are stored together in insertion order", async () => {
      await run(cmdSet, ["openai/dev", "ALPHA"], "a\n");
      await run(cmdSet, ["openai/dev", "BRAVO"], "b\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets).toHaveLength(1);
      expect(store.secrets[0]?.fields.map((f) => f.key)).toEqual(["ALPHA", "BRAVO"]);
    });

    it("multiple distinct secrets coexist in one store", async () => {
      await run(cmdSet, ["openai/dev", "K"], "a\n");
      await run(cmdSet, ["stripe/live", "K"], "b\n");
      const store = await loadStore(PASSPHRASE, storePath());
      expect(store.secrets.map((s) => s.slug)).toEqual(["openai/dev", "stripe/live"]);
    });
  });

  // ---------------------------------------------------------------------------
  // cmdSet: passphrase handling
  // ---------------------------------------------------------------------------
  describe("cmdSet — key handling", () => {
    it("works with no LOCKIT_PASSPHRASE, using the auto-managed keyfile", async () => {
      const env = { ...process.env };
      delete env.LOCKIT_PASSPHRASE;
      const set = await run(cmdSet, ["openai/dev", "K"], "v\n", env);
      expect(set.code).toBe(0);
      expect(set.err).toBe("");
    });

    it("honors LOCKIT_PASSPHRASE as an override when set", async () => {
      const env = { ...process.env, LOCKIT_PASSPHRASE: "x".repeat(512) };
      const set = await run(cmdSet, ["openai/dev", "K"], "v\n", env);
      expect(set.code).toBe(0);
      const store = await loadStore("x".repeat(512), storePath());
      expect(store.secrets[0]?.fields[0]?.value).toBe("v");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdLs: value-free listing
  // ---------------------------------------------------------------------------
  describe("cmdLs — value-free listing", () => {
    it("prints nothing for an empty store and exits 0", async () => {
      const ls = await run(cmdLs, []);
      expect(ls.code).toBe(0);
      expect(ls.out).toBe("");
      expect(ls.err).toBe("");
    });

    it("lists a single-field secret value-free: '<slug>  [<schema>]  <KEY>'", async () => {
      await run(cmdSet, ["openai/dev", "OPENAI_API_KEY"], `${SECRET}\n`);
      const ls = await run(cmdLs, []);
      expect(ls.code).toBe(0);
      expect(ls.out).toBe("openai/dev  [openai]  OPENAI_API_KEY\n");
      expect(ls.out).not.toContain(SECRET);
    });

    it("shows multiple field keys comma-separated in insertion order", async () => {
      await run(cmdSet, ["openai/dev", "ALPHA"], "a\n");
      await run(cmdSet, ["openai/dev", "BRAVO"], "b\n");
      await run(cmdSet, ["openai/dev", "CHARLIE"], "c\n");
      const ls = await run(cmdLs, []);
      expect(ls.out).toBe("openai/dev  [openai]  ALPHA,BRAVO,CHARLIE\n");
    });

    it("uses exactly two spaces around the [schema] token", async () => {
      await run(cmdSet, ["openai/dev", "K", "--schema", "custom"], "v\n");
      const ls = await run(cmdLs, []);
      expect(ls.out).toBe("openai/dev  [custom]  K\n");
    });

    it("lists multiple secrets, one per line, each ending in a newline", async () => {
      await run(cmdSet, ["openai/dev", "K"], "a\n");
      await run(cmdSet, ["stripe/live", "K"], "b\n");
      const ls = await run(cmdLs, []);
      const lines = ls.out.split("\n");
      expect(lines).toEqual(["openai/dev  [openai]  K", "stripe/live  [stripe]  K", ""]);
    });

    it("never reveals a value even when the secret has a file-type field", async () => {
      await run(cmdSet, ["openai/dev", "TOKEN", "--file"], `${SECRET}\n`);
      const ls = await run(cmdLs, []);
      expect(ls.out).toContain("openai/dev  [openai]  TOKEN");
      expect(ls.out).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------------
  // cmdLs: passphrase / error handling
  // ---------------------------------------------------------------------------
  describe("cmdLs — key and error handling", () => {
    it("rejects a wrong passphrase with a clear error (rejected promise -> caught by index)", async () => {
      await run(cmdSet, ["openai/dev", "K"], `${SECRET}\n`);
      const env = { ...process.env, LOCKIT_PASSPHRASE: "wrong-passphrase" };
      // cmdLs does not catch the loadStore rejection itself; index.ts is the
      // top-level catch. Here we assert the handler rejects with the clear msg.
      await expect(run(cmdLs, [], "", env)).rejects.toThrow(/wrong passphrase or corrupted/);
    });

    it("surfaces a corrupted store file as a clear error", async () => {
      await run(cmdSet, ["openai/dev", "K"], "v\n"); // creates the dir + file
      await writeFile(storePath(), "this is not a valid sealed blob");
      await expect(run(cmdLs, [])).rejects.toThrow(/wrong passphrase or corrupted/);
    });
  });

  describe("cmdLs --vars — value-free variable discovery", () => {
    it("lists each variable with its bundle, value-free and sorted", async () => {
      await run(cmdSet, ["app/dev", "FOO"], `${SECRET}\n`);
      await run(cmdSet, ["app/dev", "BAR"], "bar-value\n");
      const ls = await run(cmdLs, ["--vars"]);
      expect(ls.code).toBe(0);
      const lines = ls.out.trim().split("\n");
      expect(lines[0]).toMatch(/^BAR {2}\[app\/dev] {2}hasValue$/);
      expect(lines[1]).toMatch(/^FOO {2}\[app\/dev] {2}hasValue$/);
      expect(ls.out).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------------
  // cmdRun: injection + masking (drives a real node child)
  // ---------------------------------------------------------------------------
  describe("cmdRun — injection and masking", () => {
    it("injects env-type fields; child reads the value, lockit masks it in output", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write(process.env.MYKEY ?? 'MISSING')",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain("MISSING"); // injection worked
      expect(r.out).not.toContain(SECRET); // but masked
      expect(r.out).toBe("***");
    });

    it("masks the value on stderr too", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stderr.write(process.env.MYKEY ?? 'MISSING')",
      ]);
      expect(r.code).toBe(0);
      expect(r.err).not.toContain(SECRET);
      expect(r.err).toBe("***");
    });

    it("keeps a secret masked when the child splits it across two timed writes", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "const v=process.env.MYKEY;process.stdout.write('A'+v.slice(0,10));setTimeout(()=>process.stdout.write(v.slice(10)+'B'),30)",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain(SECRET);
      expect(r.out).toBe("A***B");
    });

    it("masks longest-first when one value is a substring of another", async () => {
      // Two fields: short value is a substring of the long value.
      await run(cmdSet, ["openai/dev", "SHORT"], "abc\n");
      await run(cmdSet, ["openai/dev", "LONG"], "abcXYZ\n");
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write(process.env.LONG + '|' + process.env.SHORT)",
      ]);
      expect(r.code).toBe(0);
      // The long value is fully masked (not partially left as 'XYZ'); the short too.
      expect(r.out).not.toContain("abc");
      expect(r.out).not.toContain("XYZ");
      expect(r.out).toBe("***|***");
    });

    it("preserves non-value output and only masks the value", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write('before ' + process.env.MYKEY + ' after')",
      ]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("before *** after");
    });

    it("does not inject file-type fields into the child env (v1: env-only)", async () => {
      await run(cmdSet, ["openai/dev", "FILEFIELD", "--file"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write(process.env.FILEFIELD === undefined ? 'ABSENT' : 'PRESENT')",
      ]);
      expect(r.code).toBe(0);
      // Not injected -> child reports ABSENT, and the value never appears.
      expect(r.out).toBe("ABSENT");
      expect(r.out).not.toContain(SECRET);
    });

    it("injects every env-type field of a multi-field secret", async () => {
      await run(cmdSet, ["openai/dev", "A"], "aaa\n");
      await run(cmdSet, ["openai/dev", "B"], "bbb\n");
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.stdout.write((process.env.A?'1':'0')+(process.env.B?'1':'0'))",
      ]);
      expect(r.code).toBe(0);
      // Both injected -> '11', then masked values don't leak.
      expect(r.out).toBe("11");
      expect(r.out).not.toContain("aaa");
      expect(r.out).not.toContain("bbb");
    });

    it("the child inherits the parent env in addition to the injected vars", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const env = { ...process.env, INHERITED_MARKER: "marker-123" };
      const r = await run(
        cmdRun,
        ["openai/dev", "node", "-e", "process.stdout.write(process.env.INHERITED_MARKER ?? 'NO')"],
        "",
        env,
      );
      expect(r.code).toBe(0);
      expect(r.out).toBe("marker-123");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdRun: argument handling and -- separator
  // ---------------------------------------------------------------------------
  describe("cmdRun — argument handling", () => {
    it("supports the explicit -- separator before the command", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, ["openai/dev", "--", "node", "-e", "process.stdout.write('ok')"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("ok");
    });

    it("supports the no-'--' form too", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, ["openai/dev", "node", "-e", "process.stdout.write('ok')"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("ok");
    });

    it("passes command arguments through exactly", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "--",
        "node",
        "-e",
        "process.stdout.write(process.argv.slice(1).join(','))",
        "one",
        "two",
      ]);
      expect(r.code).toBe(0);
      // argv[1..] inside the child are the script args after `-e <script>`.
      expect(r.out).toBe("one,two");
    });
  });

  // ---------------------------------------------------------------------------
  // cmdRun: error / exit-code handling
  // ---------------------------------------------------------------------------
  describe("cmdRun — error and exit-code handling", () => {
    it("requires a slug (none given) -> usage error, exit 1", async () => {
      const r = await run(cmdRun, []);
      expect(r.code).toBe(1);
      expect(r.err).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });

    it("requires a command (slug only) -> usage error, exit 1", async () => {
      const r = await run(cmdRun, ["openai/dev"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });

    it("requires a command after a bare -- -> usage error, exit 1", async () => {
      const r = await run(cmdRun, ["openai/dev", "--"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("usage: lockit run <slug> [--] <cmd> [args...]");
    });

    it("a missing slug is a hard error naming the slug, exit 1 (not ambiguous)", async () => {
      const r = await run(cmdRun, ["nope/missing", "node", "-e", ""]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("no secret: nope/missing");
    });

    it("does not prefix-match or substring-match slugs (strict 0/1/N)", async () => {
      await run(cmdSet, ["openai/dev", "K"], "v\n");
      // 'openai' is a prefix of the stored 'openai/dev' but must NOT resolve.
      const r = await run(cmdRun, ["openai", "node", "-e", ""]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("no secret: openai");
    });

    it("propagates the child's own non-zero exit code", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, ["openai/dev", "node", "-e", "process.exit(7)"]);
      expect(r.code).toBe(7);
    });

    it("propagates exit code 0 on child success", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, ["openai/dev", "node", "-e", "process.exit(0)"]);
      expect(r.code).toBe(0);
    });

    it("returns 128 + signum for a SIGKILL-terminated child (137)", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.kill(process.pid, 'SIGKILL')",
      ]);
      expect(r.code).toBe(137);
    });

    it("returns 128 + signum for a SIGTERM-terminated child (143)", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, [
        "openai/dev",
        "node",
        "-e",
        "process.kill(process.pid, 'SIGTERM')",
      ]);
      expect(r.code).toBe(143);
    });

    it("reports a spawn failure (command not found) on stderr with exit 1", async () => {
      await run(cmdSet, ["openai/dev", "MYKEY"], `${SECRET}\n`);
      const r = await run(cmdRun, ["openai/dev", "this-binary-does-not-exist-lockit-test", "arg"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("failed to run this-binary-does-not-exist-lockit-test");
      expect(r.err).not.toContain(SECRET);
    });
  });

  // ---------------------------------------------------------------------------
  // Invariant: lockit's own output never carries a secret value
  // ---------------------------------------------------------------------------
  describe("invariant — lockit output is value-free", () => {
    it("a usage error from run contains no value", async () => {
      const r = await run(cmdRun, []);
      expect(r.err).not.toContain(SECRET);
    });

    it("a missing-slug error contains the slug but no value", async () => {
      await run(cmdSet, ["openai/dev", "K"], `${SECRET}\n`);
      const r = await run(cmdRun, ["other/missing", "node", "-e", ""]);
      expect(r.err).toContain("other/missing");
      expect(r.err).not.toContain(SECRET);
    });
  });
});
