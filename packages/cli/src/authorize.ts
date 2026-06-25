import { openSync, closeSync } from "node:fs";
import * as tty from "node:tty";

/** Prompt the human on /dev/tty (echo off) for the passphrase that authorizes a
 *  pull. Resolves null if no controlling terminal is available or on Ctrl-C.
 *  An agent that drives the child's stdin cannot answer a /dev/tty prompt. */
export function ttyAuthorize(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.env.LOCKIT_PULL_YES === "1") {
      process.stderr.write("warning: LOCKIT_PULL_YES=1 — pull authorization gate bypassed\n");
      resolve(process.env.LOCKIT_PASSPHRASE ?? null);
      return;
    }

    let fd: number;
    try {
      fd = openSync("/dev/tty", "r+");
    } catch {
      resolve(null);
      return;
    }

    const input = new tty.ReadStream(fd);
    const output = new tty.WriteStream(fd);
    output.write("lockit: enter passphrase to authorize pull: ");
    try { input.setRawMode(true); } catch { /* best effort */ }

    let buf = "";
    const finish = (val: string | null) => {
      try { input.setRawMode(false); } catch { /* ignore */ }
      output.write("\n");
      input.destroy();
      output.destroy();
      try { closeSync(fd); } catch { /* streams may already own/close fd */ }
      resolve(val);
    };

    input.on("data", (chunk: Buffer) => {
      for (const ch of chunk.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return finish(buf);
        if (ch === "") return finish(null); // Ctrl-C
        if (ch === "") { buf = buf.slice(0, -1); continue; } // backspace
        buf += ch;
      }
    });
  });
}
