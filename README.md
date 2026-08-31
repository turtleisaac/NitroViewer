NitroViewer
===========

[![License: GNU GPL 3.0](https://img.shields.io/badge/license-GPLv3-blue.svg?logo=gnu&logoColor=white)](https://www.gnu.org/licenses/gpl-3.0)
[![Live](https://img.shields.io/badge/live-nitroviewer.com-5b7cfa)](https://nitroviewer.com)

**NitroViewer** is a modern viewer and editor for Nintendo DS ROMs &mdash; a web replacement for
[Tinke](https://github.com/pleonex/tinke). Open a `.nds`, browse its filesystem, and
view or edit its graphics and 3D models. Nothing is uploaded; everything runs on your device.

Live at **[nitroviewer.com](https://nitroviewer.com)**.

> Powered by [Nds4j](https://github.com/turtleisaac/Nds4j).

![NitroViewer rendering a Nintendo DS model](web/public/og.png)

What it does
------------

* **Browse** a ROM's filesystem and its NARC archives, with full-path navigation.
* **2D graphics** &mdash; NCGR sprites, NCLR palettes, NSCR tilemaps, NCER cells and NANR animations,
  with palette pairing, sub-palette selection, LZ decompression and PNG export.
* **3D &amp; effects** &mdash; NSBMD models + NSBTX textures, NSBCA skeletal and
  NSBMA / NSBVA / NSBTP animations, and SPA particles; orbit/zoom, glTF export and PNG capture.
* **Sound** &mdash; browse an SDAT, play SSEQ / SWAV / STRM, view an SSEQ as a note track, and import
  a WAV over a wave.
* **Edit &amp; save** &mdash; replace any file, or import a PNG over a sprite, then download the
  modified `.nds`.

Desktop app
-----------

`make build` packages NitroViewer as an Electron app for your OS (a `.dmg` / `.zip` on
macOS, NSIS installer on Windows, AppImage / `.deb` / tarball on Linux). Artifacts land in
`release/`.

Publishing a GitHub Release builds Mac (arm64 + x64), Windows (x64 + arm64), and Linux (x64
AppImage, `.deb`, and tar.gz) on Actions, attaches them plus a `SHA256SUMS` file, and (when
Apple signing secrets are set) notarizes the Mac builds. Packaged apps check GitHub Releases
on startup and offer a **Download** button if a newer version exists — nothing is fetched
automatically.

The desktop shell hosts the same in-browser app and vendors the CheerpJ Java 8 runtime,
so once built it runs fully offline. The ROM never leaves the machine. The website at
nitroviewer.com still loads CheerpJ from the CDN.

### Signing macOS builds (Apple Developer)

CI stays unsigned until these GitHub Actions secrets exist on the NitroViewer repo
(`Settings → Secrets and variables → Actions`):

1. In [Apple Developer](https://developer.apple.com/account/resources/certificates/list) create a
   **Developer ID Application** certificate (not “Apple Development”, not Mac App Store).
2. In Keychain Access, export that cert as a `.p12` (set a password).
3. Encode it: `base64 -i DeveloperID.p12 | pbcopy`
4. Add secrets:
   * `CSC_LINK` — the base64 p12 (the whole string, no extra whitespace)
   * `CSC_KEY_PASSWORD` — the p12 password
   * `APPLE_ID` — the Apple ID email that owns the team
   * `APPLE_APP_SPECIFIC_PASSWORD` — an [app-specific password](https://appleid.apple.com)
     (Account → Sign-In and Security → App-Specific Passwords)
   * `APPLE_TEAM_ID` — the 10-character Team ID (Membership details)

The next published GitHub Release will sign and notarize the `.dmg` / `.zip`. Locally, with
the cert already in your login keychain: `make build CSC_IDENTITY_AUTO_DISCOVERY=true`.

Windows Authenticode is not wired up; SmartScreen will still warn on the `.exe` until a
Windows code-signing certificate is added.

License
-------

GPLv3 (see [LICENSE](LICENSE)), matching Nds4j.
