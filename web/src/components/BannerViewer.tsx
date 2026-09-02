import { useEffect, useRef, useState } from "react";
import { useStore } from "../state/store";
import type { BannerInfo } from "../transport";
import { base64ToBytes, download } from "../util";

// Friendly labels for IconBanner.Language names, in stored order.
const LANGUAGE_LABELS: Record<string, string> = {
  JAPANESE: "Japanese",
  ENGLISH: "English",
  FRENCH: "French",
  GERMAN: "German",
  ITALIAN: "Italian",
  SPANISH: "Spanish",
  CHINESE: "Chinese",
  KOREAN: "Korean",
};

const VERSION_NOTES: Record<number, string> = {
  0x0001: "original (6 languages)",
  0x0002: "+ Chinese",
  0x0003: "+ Korean",
  0x0103: "+ DSi animated icon",
};

/** The DS home-menu icon + per-language titles (the ROM's icon/title banner). View and edit both. */
export function BannerViewer() {
  const client = useStore((s) => s.client);
  const romHandle = useStore((s) => s.romHandle)!;
  const editVersion = useStore((s) => s.editVersion);
  const setBannerIcon = useStore((s) => s.setBannerIcon);
  const setBannerTitle = useStore((s) => s.setBannerTitle);

  const [banner, setBanner] = useState<BannerInfo | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Local edited copies of the titles, so typing is smooth; a per-language Save persists to the ROM.
  const [drafts, setDrafts] = useState<string[]>([]);
  const iconInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setErr(undefined);
    client
      .getBanner(romHandle)
      .then((b) => {
        if (!alive) return;
        setBanner(b);
        setDrafts(b.titles.map((t) => t.text));
      })
      .catch((e) => alive && setErr((e as Error).message));
    return () => {
      alive = false;
    };
  }, [client, romHandle, editVersion]);

  if (err) return <div className="error">{err}</div>;
  if (!banner) return <div className="placeholder">Reading banner…</div>;
  if (!banner.present) return <div className="placeholder">This ROM has no icon/title banner.</div>;

  async function replaceIcon(file: File) {
    setBusy(true);
    setErr(undefined);
    try {
      await setBannerIcon(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      // setIcon's own validation messages (32×32 / ≤15 colors) surface here verbatim.
      alert("Replace icon failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTitle(ordinal: number) {
    setBusy(true);
    setErr(undefined);
    try {
      await setBannerTitle(ordinal, drafts[ordinal]);
    } catch (e) {
      alert("Save title failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const versionNote = VERSION_NOTES[banner.version];
  const dirtyTitle = (i: number) => drafts[i] !== banner.titles[i].text;

  return (
    <div className="banner">
      <div className="banner-icon-block">
        <img
          className="banner-icon sprite-img"
          src={banner.iconPng}
          width={128}
          height={128}
          alt="Game icon"
        />
        <div className="banner-icon-actions">
          <div className="dim">
            32×32 · 16-color
            <br />
            v{banner.version.toString(16).padStart(4, "0")}
            {versionNote ? ` (${versionNote})` : ""}
          </div>
          <button
            className="btn btn--sm"
            disabled={busy}
            title="Download the icon as a PNG"
            onClick={() => download("icon.png", base64ToBytes(banner.iconPng.split(",")[1]), "image/png")}
          >
            Export PNG
          </button>
          <button
            className="btn btn--sm"
            disabled={busy}
            title="Replace the icon from a 32×32 image (≤15 opaque colors; transparency allowed)"
            onClick={() => iconInputRef.current?.click()}
          >
            Replace icon…
          </button>
          <input
            ref={iconInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void replaceIcon(f);
            }}
          />
        </div>
      </div>

      <div className="banner-titles">
        <div className="banner-titles-head">Titles</div>
        {banner.titles.map((t, i) => (
          <label className="banner-title-field" key={t.language}>
            <span className="banner-title-lang">{LANGUAGE_LABELS[t.language] ?? t.language}</span>
            <textarea
              className="banner-title-input"
              rows={3}
              value={drafts[i] ?? ""}
              spellCheck={false}
              // Up to three lines of ≤127 UTF-16 units; the facade rejects overflow, but hint the limit.
              maxLength={127}
              onChange={(e) => setDrafts((d) => d.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <button
              className="btn btn--sm"
              disabled={busy || !dirtyTitle(i)}
              title={dirtyTitle(i) ? "Save this title to the ROM" : "No changes"}
              onClick={() => void saveTitle(i)}
            >
              Save
            </button>
          </label>
        ))}
        <p className="dim">
          The DS home menu shows up to three lines per language. Use <strong>Save ROM</strong> to download the
          edited .nds.
        </p>
      </div>
    </div>
  );
}
