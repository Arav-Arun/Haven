import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, makeZip } from "../src/zip";

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  });

  it("writes an archive that unzip accepts, with unique, safe names", async () => {
    const files = new Map<string, Blob>([
      ["report.pdf", new Blob(["%PDF-1.4 a"])],
      ["../escape.txt", new Blob(["x"])],
      ["notes ✓.txt", new Blob(["unicode name"])],
    ]);
    const zip = await makeZip(files);
    const dir = mkdtempSync(join(tmpdir(), "cloak-zip-"));
    const path = join(dir, "t.zip");
    writeFileSync(path, new Uint8Array(await zip.arrayBuffer()));
    const out = execFileSync("unzip", ["-t", path]).toString();
    expect(out).toMatch(/No errors detected/);
    const list = execFileSync("unzip", ["-Z1", path]).toString().trim().split("\n");
    // No path escapes the archive. (macOS's unzip prints non-ASCII names as "?", so the UTF-8 name is checked in the bytes.)
    expect(list.slice(0, 2)).toEqual(["report.pdf", "__escape.txt"]);
    expect(list).toHaveLength(3);
    const bytes = new Uint8Array(await zip.arrayBuffer());
    expect(Buffer.from(bytes).includes(Buffer.from("notes ✓.txt", "utf8"))).toBe(true);
  });
});
