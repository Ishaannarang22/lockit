import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeSkillDir,
  codexSkillDir,
  installSkill,
  installCodexSkill,
  refreshInstalledSkills,
} from "./skill.js";

describe("refreshInstalledSkills", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "lockit-user-home-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("does nothing when no skill was ever installed (respects opt-out)", () => {
    expect(refreshInstalledSkills(home)).toEqual([]);
    expect(existsSync(claudeSkillDir(home))).toBe(false);
    expect(existsSync(codexSkillDir(home))).toBe(false);
  });

  it("rewrites a stale installed Claude skill to the current content", () => {
    const path = installSkill(home);
    writeFileSync(path, "# old skill from a previous version\n");
    const refreshed = refreshInstalledSkills(home);
    expect(refreshed).toEqual([path]);
    expect(readFileSync(path, "utf8")).toContain("lockit relay");
  });

  it("rewrites both Claude and Codex skills when both are stale", () => {
    const claudePath = installSkill(home);
    const codexPath = installCodexSkill(home);
    writeFileSync(claudePath, "stale\n");
    writeFileSync(codexPath, "stale\n");
    const refreshed = refreshInstalledSkills(home);
    expect(refreshed.sort()).toEqual([claudePath, codexPath].sort());
    expect(readFileSync(codexPath, "utf8")).toContain("lockit relay");
  });

  it("leaves an up-to-date skill untouched and reports nothing", () => {
    installSkill(home);
    expect(refreshInstalledSkills(home)).toEqual([]);
  });

  it("never throws on filesystem trouble", () => {
    // A directory where SKILL.md should be makes readFileSync throw EISDIR.
    mkdirSync(join(claudeSkillDir(home), "SKILL.md"), { recursive: true });
    expect(() => refreshInstalledSkills(home)).not.toThrow();
  });
});
