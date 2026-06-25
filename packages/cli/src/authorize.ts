import { openSync, closeSync } from "node:fs";
import * as tty from "node:tty";

/** Ask the human, on /dev/tty, to confirm a pull (y/N). Resolves false if no
 *  controlling terminal is available or on anything but an explicit yes. An
 *  agent that drives the child's stdin cannot answer a /dev/tty prompt, so it
 *  cannot self-authorize. `LOCKIT_PULL_YES=1` bypasses the prompt. */
export function ttyAuthorize(prompt = "write secret values to the env file?"): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.env.LOCKIT_PULL_YES === "1") {
      process.stderr.write("warning: LOCKIT_PULL_YES=1 — confirmation skipped\n");
      resolve(true);
      return;
    }

    let fd: number;
    try {
      fd = openSync("/dev/tty", "r+");
    } catch {
      resolve(false);
      return;
    }

    const input = new tty.ReadStream(fd);
    const output = new tty.WriteStream(fd);
    output.write(`lockit: ${prompt} [y/N] `);
    try {
      input.setRawMode(true);
    } catch {
      /* best effort */
    }

    const finish = (ok: boolean) => {
      try {
        input.setRawMode(false);
      } catch {
        /* ignore */
      }
      output.write("\n");
      input.destroy();
      output.destroy();
      try {
        closeSync(fd);
      } catch {
        /* streams may already own/close fd */
      }
      resolve(ok);
    };

    input.on("data", (chunk: Buffer) => {
      const ch = chunk.toString("utf8")[0] ?? "";
      finish(ch === "y" || ch === "Y");
    });
  });
}
