// Uncompressed (STORED) ZIP writer. Java ZipInputStream reads this as the payload of
// CheerpjFacade.openUnpackedRom — the folder the frontend picks is packed here so it can
// cross the CheerpJ boundary as one trailing byte[], then NintendoDsRom.fromUnpacked runs
// against a real directory on the Java side.

export interface ZipFile {
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Skip OS clutter that would break Nds4j's overlay-filename sort or FNT walk. */
export function isSkippableUnpackedPath(path: string): boolean {
  const n = path.replace(/\\/g, "/");
  const parts = n.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  return parts.some(
    (p) => p === "__MACOSX" || p === ".DS_Store" || p === "Thumbs.db" || p === ".git" || p.startsWith("._")
  );
}

function u16(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}
function u32(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function normalizeZipPath(path: string): string {
  let n = path.replace(/\\/g, "/");
  while (n.startsWith("./")) n = n.substring(2);
  if (n.startsWith("/")) n = n.substring(1);
  if (n.endsWith("/")) n = n.slice(0, -1);
  return n;
}

/**
 * Build a STORED (method 0) ZIP of {@code files}. Paths use forward slashes; skippable OS junk is
 * dropped. Empty input throws.
 */
export function zipStore(files: ZipFile[]): Uint8Array {
  const entries: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];
  const locals: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const path = normalizeZipPath(f.path);
    if (!path || isSkippableUnpackedPath(path)) continue;
    if (path.split("/").some((p) => p === ".." || p === "")) {
      throw new Error("illegal path in unpacked folder: " + f.path);
    }
    const name = utf8(path);
    const crc = crc32(f.data);
    const size = f.data.length;
    // local file header — UTF-8 flag (bit 11) so Java ZipInputStream keeps non-ASCII names
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(size),
      u32(size),
      u16(name.length),
      u16(0),
      name,
      f.data,
    ]);
    entries.push({ name, crc, size, offset });
    locals.push(local);
    offset += local.length;
  }
  if (entries.length === 0) throw new Error("the unpacked folder contained no files");

  const centrals: Uint8Array[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(e.crc),
      u32(e.size),
      u32(e.size),
      u16(e.name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(e.offset),
      e.name,
    ]);
    centrals.push(central);
    centralSize += central.length;
  }

  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, ...centrals, eocd]);
}
