// Nitro format → file extension, for naming extracted files like Tinke (numbered/nameless entries get the
// format's extension; a resource that already carries a real FNT filename with an extension keeps it).
const FORMAT_EXT: Record<string, string> = {
  NARC: "narc", NCGR: "ncgr", NCLR: "nclr", NSCR: "nscr", NCER: "ncer", NANR: "nanr",
  NSBMD: "nsbmd", NSBTX: "nsbtx", NSBCA: "nsbca", NSBTP: "nsbtp", NSBTA: "nsbta",
  NSBVA: "nsbva", NSBMA: "nsbma", SPA: "spa",
  SDAT: "sdat", SSEQ: "sseq", SSAR: "ssar", SBNK: "sbnk", SWAR: "swar", SWAV: "swav", STRM: "strm",
};

/** A download filename for an extracted file: keeps a real FNT name (with extension), else `<base>.<ext>`. */
export function exportFileName(name: string, format: string): string {
  const base = ((name.split(/[/:]/).pop() || "file").trim().replace(/^#/, "").replace(/[^\w.\-]+/g, "_")) || "file";
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base; // already a real filename like "pl_pokegra.narc"
  return `${base}.${FORMAT_EXT[format] || "bin"}`;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function download(name: string, bytes: Uint8Array, mime = "application/octet-stream") {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A short hex dump (offset | bytes | ascii) of the first `limit` bytes. */
export function hexDump(bytes: Uint8Array, limit = 512): string {
  const lines: string[] = [];
  const n = Math.min(bytes.length, limit);
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(off.toString(16).padStart(6, "0") + "  " + hex.padEnd(16 * 3 - 1) + "  " + ascii);
  }
  if (bytes.length > n) lines.push(`… ${bytes.length - n} more bytes`);
  return lines.join("\n");
}
