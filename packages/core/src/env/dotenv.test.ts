import { describe, it, expect } from "vitest";
import { parseDotenv, mergeDotenv } from "./dotenv.js";

describe("parseDotenv", () => {
  it("parses plain KEY=VALUE", () => {
    expect(parseDotenv("FOO=bar")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("strips an `export ` prefix", () => {
    expect(parseDotenv("export FOO=bar")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("strips matching single or double quotes", () => {
    expect(parseDotenv(`A="x y"\nB='z'`)).toEqual([
      { key: "A", value: "x y" },
      { key: "B", value: "z" },
    ]);
  });
  it("ignores blank lines and # comments", () => {
    expect(parseDotenv("\n# c\nFOO=bar\n")).toEqual([{ key: "FOO", value: "bar" }]);
  });
  it("tolerates CRLF endings", () => {
    expect(parseDotenv("FOO=bar\r\nBAZ=qux")).toEqual([
      { key: "FOO", value: "bar" },
      { key: "BAZ", value: "qux" },
    ]);
  });
  it("keeps `=` characters inside the value", () => {
    expect(parseDotenv("URL=postgres://a:b@h/d?x=1")).toEqual([
      { key: "URL", value: "postgres://a:b@h/d?x=1" },
    ]);
  });
  it("keeps both duplicate keys (consumer upserts)", () => {
    expect(parseDotenv("FOO=1\nFOO=2")).toEqual([
      { key: "FOO", value: "1" },
      { key: "FOO", value: "2" },
    ]);
  });
  it("throws naming the line number on a line with no `=`", () => {
    expect(() => parseDotenv("FOO=bar\noops")).toThrow(/line 2/);
  });
  it("throws naming the line number on an invalid key", () => {
    expect(() => parseDotenv("1BAD=x")).toThrow(/line 1/);
  });
});

describe("mergeDotenv", () => {
  it("appends new keys to empty text with a trailing newline", () => {
    const r = mergeDotenv("", [{ key: "FOO", value: "bar" }], { force: false });
    expect(r.text).toBe("FOO=bar\n");
    expect(r.wrote).toEqual(["FOO"]);
    expect(r.skipped).toEqual([]);
  });
  it("skips a key already present, leaving the file unchanged", () => {
    const r = mergeDotenv("FOO=old\n", [{ key: "FOO", value: "new" }], { force: false });
    expect(r.text).toBe("FOO=old\n");
    expect(r.wrote).toEqual([]);
    expect(r.skipped).toEqual(["FOO"]);
  });
  it("force overwrites a present key, preserving other lines", () => {
    const r = mergeDotenv("KEEP=1\nFOO=old\n", [{ key: "FOO", value: "new" }], { force: true });
    expect(r.text).toBe("KEEP=1\nFOO=new\n");
    expect(r.wrote).toEqual(["FOO"]);
    expect(r.skipped).toEqual([]);
  });
  it("quotes a value containing whitespace when serializing", () => {
    const r = mergeDotenv("", [{ key: "A", value: "x y" }], { force: false });
    expect(r.text).toBe('A="x y"\n');
  });
  it("appends after existing content without a trailing newline", () => {
    const r = mergeDotenv("KEEP=1", [{ key: "FOO", value: "bar" }], { force: false });
    expect(r.text).toBe("KEEP=1\nFOO=bar\n");
  });
});
