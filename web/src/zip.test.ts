import { describe, expect, it } from "vitest";
import { crc32, isSkippableUnpackedPath, zipStore } from "./zip";

describe("zipStore", () => {
  it("writes a STORED zip Java ZipInputStream can recognise", () => {
    const data = new TextEncoder().encode("hello");
    const zip = zipStore([{ path: "header.bin", data }]);
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // method = 0 (store) at local header + 8
    expect(zip[8]).toBe(0);
    expect(zip[9]).toBe(0);
    // EOCD signature at the end (22-byte record, no comment)
    const n = zip.length;
    expect(zip[n - 22]).toBe(0x50);
    expect(zip[n - 21]).toBe(0x4b);
    expect(zip[n - 20]).toBe(0x05);
    expect(zip[n - 19]).toBe(0x06);
    expect(zip[n - 14]).toBe(1); // entries on this disk
    expect(zip[n - 12]).toBe(1); // total entries
  });

  it("embeds the file bytes after the local header + name", () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const name = "arm9.bin";
    const zip = zipStore([{ path: name, data }]);
    const start = 30 + name.length;
    expect(Array.from(zip.subarray(start, start + 4))).toEqual([1, 2, 3, 4]);
  });

  it("drops OS junk and throws when nothing remains", () => {
    expect(isSkippableUnpackedPath("foo/__MACOSX/bar")).toBe(true);
    expect(isSkippableUnpackedPath("rom/.DS_Store")).toBe(true);
    expect(isSkippableUnpackedPath("rom/header.bin")).toBe(false);
    expect(() => zipStore([{ path: ".DS_Store", data: new Uint8Array([1]) }])).toThrow(/no files/);
  });

  it("crc32 matches the known vector for '123456789'", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
