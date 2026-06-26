import { ttyAuthorize } from "./authorize.js";
import { runSwiftGate } from "./swiftgate.js";

/** Result of running the OS local-auth gate: a number is the gate's exit code
 *  (0 = authenticated, 2 = explicit user cancel/deny, 3 = cannot evaluate);
 *  null means the gate could not be launched at all (no toolchain / spawn error). */
export type GateResult = number | null;

export interface AuthorizeDeps {
  platform: NodeJS.Platform;
  /** Run the OS presence gate with a value-free reason. */
  runGate: (reason: string) => Promise<GateResult>;
  /** Cross-platform fallback (tty y/N), used ONLY when the OS gate is unavailable. */
  fallback: (prompt?: string) => Promise<boolean>;
  warn?: (s: string) => void;
}

/** Build a presence-confirmation function gated by the OS. On macOS it runs the
 *  Touch ID / account-password dialog; an explicit cancel is a hard "no". The tty
 *  y/N prompt is reached only when the OS gate genuinely cannot run (non-macOS,
 *  no toolchain, or no GUI session) — never as the macOS default. */
export function makeAuthorize(deps: AuthorizeDeps): (prompt?: string) => Promise<boolean> {
  return async (prompt?: string): Promise<boolean> => {
    if (deps.platform !== "darwin") return deps.fallback(prompt);

    const reason = prompt ?? "confirm it's you";
    const code = await deps.runGate(reason);
    if (code === 0) return true; // Touch ID or account password confirmed
    if (code === 2) return false; // explicit cancel/deny — do not fall back

    // code === 3 (cannot evaluate) or null (no toolchain) → degrade to the tty prompt.
    deps.warn?.(
      "lockit: Touch ID / password unavailable; falling back to terminal confirmation\n",
    );
    return deps.fallback(prompt);
  };
}

/** The production presence gate: macOS Touch ID / account-password dialog, with
 *  the tty y/N prompt reached only when LocalAuthentication genuinely can't run
 *  (non-macOS, no Swift toolchain, or no GUI session). */
export const presenceAuthorize = makeAuthorize({
  platform: process.platform,
  runGate: (reason) => runSwiftGate(reason),
  fallback: ttyAuthorize,
  warn: (s) => process.stderr.write(s),
});
