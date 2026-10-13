# pngz

A lossless image format. PNG's filtering, Zstandard's compression, and dictionaries.

Live: https://pngz.sodiumoptifine45.workers.dev/

---

## What it is

pngz is a lossless image format. Same pixels in, same pixels out.

It uses three things stacked:

1. **PNG-style filtering:** Sub, Up, Average, Paeth, chosen per row
2. **Zstandard compression:** instead of PNG's zlib
3. **Trained dictionaries:** a zstd feature PNG fundamentally cannot have

The combination wins **30–60%** over PNG on screenshots, documents, UI, line art, and icons.

---

## Results

Real measured numbers, not estimates:

| Content | pngz vs PNG |
|---------|-------------|
| Structured screenshot | **−43%** |
| Terminal capture | **−50% to −70%** |
| Documents (clean) | **−40% to −60%** |
| Icons, with dictionary | **−60% to −70%** |
| Icons, no dictionary | **+100% to +400%** (loses) |
| Complex screenshot | **−1% to −15%** |
| Photos | **0% to +5%** |
| Random noise | Loses |

The pattern is consistent: the more structured the content, the bigger the win.

---

## Try it

**Live tool:** https://pngz.sodiumoptifine45.workers.dev/

Drop a PNG or JPEG. Get a `.pngz` file. Download it.

Drop a `.pngz` back. Get a PNG.

Everything runs in your browser. No uploads, no server, no accounts.

---

## The dictionary feature

This is pngz's unique capability.

**What it does:** a trained dictionary gives the compressor a warm start. On small, similar images — icons, sprites, UI assets, it flips pngz from losing to PNG (by +150% or more) into winning (by −40% to −70%).

**How to use it:**

1. Open the live tool
2. Open the Dictionary panel
3. Add 50–500 similar images (or drop a `.zip` of them)
4. Click **Build dictionary**
5. Enable **Use dictionary**
6. Encode

Without a dictionary, small images lose. With one, they win big. That's the whole story.

---

## What it's for

Images you keep, not images you send.

pngz is a **storage format**. Encode your screenshot library, your icon collection, your documents, your UI captures. Save 30–60% of disk space. Decode to PNG when you need to share.

Same model as ZIP, FLAC, or DNG. Smaller on disk. Re-encode when you export.

---

## Format

**Magic bytes:** `89 50 4E 47 7A 0D 0A 1A`

Same as PNG except byte 4: `7A` (`z`) replaces `0D` (CR). A PNG decoder rejects pngz files and vice versa.

**Chunks:** `IHDR`, `PLTE`, `ALPH`, `IDAT`, `IEND`. Same length + type + data + CRC32 structure as PNG.

**IHDR is 16 bytes:**

| Offset | Field |
|--------|-------|
| 0–3 | width |
| 4–7 | height |
| 8 | bit depth |
| 9 | color type |
| 10 | flags (ALPH, RCT, RAW) |
| 11 | dict mode |
| 12–15 | dict hash |

**Color types:** grayscale (0), RGB (2), palette (3), grayscale+alpha (4), RGBA (6).

**Compression:** Zstandard, levels 1–22. Optional trained dictionary, referenced by hash. If zstd expands the input, pngz stores the filtered bytes raw.

**Filters:** the same five PNG uses (None, Sub, Up, Average, Paeth), selected per row.

**Color transform:** optional reversible transform (G, R−G, B−G) applied to RGB and RGBA before filtering.

---

## Browser tool

The live tool at https://pngz.sodiumoptifine45.workers.dev/ is the reference implementation.

- Pure client-side: no uploads, no server
- Codec runs in a Web Worker, so the UI never freezes
- Supports encode, decode, and PNG conversion
- Dictionary training runs in-browser via `ZDICT_trainFromBuffer`
- Optimize mode searches filter strategies and picks the smallest

Files: `index.html`, `pngz-worker.js`, `zstd.js`, `zstd.wasm`.

---

## License

zlib license.
