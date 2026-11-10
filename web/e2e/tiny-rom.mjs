import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

const FILES = [
  ["wide-phone-sprite.NCGR", "sprite.ncgr"],
  ["wide-phone-palette.NCLR", "sprite.nclr"],
  ["wide-phone-texture.NSBTX", "texture.nsbtx"],
  ["wide-phone-model.NSBMD", "model.nsbmd"],
  ["wide-desktop-sound.SDAT", "sound.sdat"],
];

/** Little-endian uint16. */
function u16(buf, offset, value) {
  buf.writeUInt16LE(value, offset);
}

/** Little-endian uint32. */
function u32(buf, offset, value) {
  buf.writeUInt32LE(value, offset);
}

/** Extra bytes a folder entry uses for its directory id. */
function folderExtra(folderId) {
  return folderId == null ? 0 : 2;
}

/** The high bit that marks a folder name. */
function folderFlag(folderId) {
  return folderId == null ? 0 : 0x80;
}

/** Write a folder's directory id after its name. */
function writeFolderId(out, nameLength, folderId) {
  if (folderId == null) return;

  u16(out, 1 + nameLength, folderId);
}

/** One filename-table entry. A folder also carries its directory id. */
function entry(name, folderId) {
  const body = Buffer.from(name, "latin1");
  const out = Buffer.alloc(1 + body.length + folderExtra(folderId));
  out[0] = body.length | folderFlag(folderId);
  body.copy(out, 1);
  writeFolderId(out, body.length, folderId);

  return out;
}

/** Build the sprite, texture, and model with Nds4j. */
async function nitroFiles(dir) {
  const jar = join(here, "../public/jars/Nds4j.jar");
  await exec("javac", ["--release", "17", "-cp", jar, "-d", dir, join(here, "TinyAssets.java")]);
  await exec("java", ["-cp", `${dir}${delimiter}${jar}`, "TinyAssets", dir]);

  const out = {};
  for (const [name, file] of FILES) out[name] = await readFile(join(dir, file));
  return out;
}

/**
 * Write a synthetic .nds whose names are long enough to overflow a phone header.
 * @returns {Promise<string>} path to the ROM
 */
export async function writeTinyRom() {
  const dir = await mkdtemp(join(tmpdir(), "nv-phone-"));
  const files = await nitroFiles(dir);
  const names = Object.keys(files);
  const rootEntries = Buffer.concat([entry("graphics", 0xf001), Buffer.from([0])]);
  const subEntries = Buffer.concat([...names.map((name) => entry(name)), Buffer.from([0])]);

  const fnt = Buffer.alloc(16 + rootEntries.length + subEntries.length);
  u32(fnt, 0, 16);
  u16(fnt, 4, 0);
  u16(fnt, 6, 2);
  u32(fnt, 8, 16 + rootEntries.length);
  u16(fnt, 12, 0);
  u16(fnt, 14, 0xf000);

  rootEntries.copy(fnt, 16);
  subEntries.copy(fnt, 16 + rootEntries.length);

  const blobs = names.map((name) => files[name]);
  const arm9 = 0x4000;
  const arm7 = 0x8000;
  const fntOff = arm7 + 0x10;
  const fatOff = fntOff + fnt.length;
  const dataOff = fatOff + blobs.length * 8;
  const rom = Buffer.alloc(dataOff + blobs.reduce((n, file) => n + file.length, 0));

  rom.write("TINY", 0, "latin1");
  rom.write("TEST", 0x0c, "latin1");
  rom.write("01", 0x10, "latin1");
  u32(rom, 0x20, arm9);
  u32(rom, 0x24, 0x02000000);
  u32(rom, 0x28, 0x02000000);
  u32(rom, 0x2c, 0x10);
  u32(rom, 0x30, arm7);
  u32(rom, 0x34, 0x02380000);
  u32(rom, 0x38, 0x02380000);
  u32(rom, 0x3c, 0x10);
  u32(rom, 0x40, fntOff);
  u32(rom, 0x44, fnt.length);
  u32(rom, 0x48, fatOff);
  u32(rom, 0x4c, blobs.length * 8);
  u32(rom, 0x80, rom.length);
  u32(rom, 0x84, 0x200);

  fnt.copy(rom, fntOff);
  let cursor = dataOff;
  blobs.forEach((file, i) => {
    u32(rom, fatOff + i * 8, cursor);
    cursor += file.length;
    u32(rom, fatOff + i * 8 + 4, cursor);
    file.copy(rom, cursor - file.length);
  });

  const path = join(dir, "tiny.nds");
  await writeFile(path, rom);
  return path;
}
