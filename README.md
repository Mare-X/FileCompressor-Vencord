# File Compressor (Vencord userplugin)

Automatically compresses **images** and **videos** so they fit Discord’s upload limit before you send them. Built for the **10 MB** free tier, with presets for 25 MB / Nitro limits or a custom cap.

Processing runs **entirely in your browser** (ffmpeg.wasm for video). Nothing is uploaded to a third-party server.

## Features

- Auto-compress when a file exceeds your target size
- Detect limit from Nitro tier, or pick 10 / 25 / 50 / 500 MB / custom
- Images: re-encoded to JPEG with quality / resolution scaling
- Videos: H.264 via ffmpeg.wasm (~31 MB download on first use)
- Toggle per attachment from the attachment action bar
- 5% safety margin so Discord’s own checks are less likely to reject the file

## Requirements

- [Vencord installed from source](https://docs.vencord.dev/installing/) (custom userplugins are not supported on the prebuilt installer alone)

## Install

1. Clone or copy this repo’s `fileCompressor` folder into your Vencord tree:

   ```
   Vencord/src/userplugins/fileCompressor/
   ```

   The folder must contain `index.tsx` (not only the repo root).

2. From the **Vencord** root (not this repo):

   ```bash
   pnpm install
   pnpm build
   ```

3. Restart Discord and enable **FileCompressor** in Vencord → Plugins.

## Settings

| Setting | Description |
|--------|-------------|
| Automatically compress | Master switch for auto mode |
| Target upload size limit | Auto from Nitro, or fixed 10/25/50/500 MB / custom |
| Custom limit (MB) | Used when mode is Custom |
| Safety margin | Fraction of limit to target (default 0.95) |
| Compress images / videos | Toggle each pipeline |
| Compress on attach | Start as soon as the file is added (recommended) |

## How to upload a large video (important)

Discord blocks oversized files **before** our code can run if you only use the normal + button on some builds.

**Reliable method:** use the **bar-chart icon** button in the chat bar (left of the text box, with the other + / GIF buttons). Tooltip: **“Compress & attach”**. Pick your MP4 → wait for compression toasts → file appears in the draft.

**Also try:** normal **+ attach** with **Intercept file picker** enabled (default) — should show `Compressing …` toasts in the console filter `[FileCompressor]`.

## Troubleshooting

1. **Rebuild Vencord** after updating the plugin (`pnpm build` in your Vencord folder), then fully restart Discord.
2. Filter the console for `[FileCompressor]` (not generic `web.*.js` spam — those are unrelated Discord warnings).
3. On start you should see: `[FileCompressor] Plugin starting` and a toast about the chart button.
4. Enable **Compress videos**. First run tries ffmpeg (~31 MB download). If Discord blocks the worker, it automatically falls back to the browser’s built-in encoder (MediaRecorder).
5. Target limit **10 MB** for free accounts.

The console messages `AnalyticsTrackImpressionContext` and `Artboard BaseGlowRemapped` are **unrelated** Discord noise, not this plugin.

## Limitations

- **Only images and videos** can be shrunk meaningfully in the browser. ZIP archives, PDFs, executables, etc. are not supported—use an external host (e.g. [bigFileUpload](https://github.com/ScattrdBlade/bigFileUpload)) for those.
- Video compression is **CPU-heavy** and can take minutes for long clips.
- First video compress downloads ffmpeg.wasm from jsDelivr (~31 MB).
- Discord’s real limit may differ slightly from documented caps; the safety margin helps.

## Author ID

Replace `authors: [{ name: "Marex", id: 0n }]` in `index.tsx` with your Discord user id if you want attribution in the plugin list.

## License

GPL-3.0-or-later (same as Vencord userplugins).
