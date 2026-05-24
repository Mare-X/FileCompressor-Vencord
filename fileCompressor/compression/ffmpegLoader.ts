import { Logger } from "@utils/Logger";

const log = new Logger("FileCompressor/FFmpeg");

const FFMPEG_VERSION = "0.12.10";
const UTIL_VERSION = "0.12.1";

type FfmpegModule = typeof import("@ffmpeg/ffmpeg");
type UtilModule = typeof import("@ffmpeg/util");

let loadPromise: Promise<import("@ffmpeg/ffmpeg").FFmpeg> | null = null;
let utilModule: UtilModule | null = null;

async function importEsm<T>(url: string): Promise<T> {
    return import(/* webpackIgnore: true */ url) as Promise<T>;
}

async function getUtil() {
    if (!utilModule) {
        utilModule = await importEsm<UtilModule>(
            `https://cdn.jsdelivr.net/npm/@ffmpeg/util@${UTIL_VERSION}/dist/esm/index.js`
        );
    }
    return utilModule;
}

/**
 * Discord runs at https://discord.com — workers cannot load from cdn.jsdelivr.net directly.
 * Every ffmpeg URL (core, wasm, worker) must be fetched and turned into a blob: URL first.
 */
export async function getFfmpeg(onStatus?: (message: string) => void) {
    if (!loadPromise) {
        loadPromise = (async () => {
            onStatus?.("Loading FFmpeg (~31 MB, one-time)…");
            log.info("Loading ffmpeg.wasm (blob URLs for Discord CSP)");

            const { FFmpeg } = await importEsm<FfmpegModule>(
                `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`
            );
            const { toBlobURL } = await getUtil();

            const coreBase = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${FFMPEG_VERSION}/dist/esm`;
            const ffmpegBase = `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm`;

            const classWorkerURL = await toBlobURL(`${ffmpegBase}/worker.js`, "text/javascript");
            const coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript");
            const wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm");
            const workerURL = await toBlobURL(`${coreBase}/ffmpeg-core.worker.js`, "text/javascript");

            const ffmpeg = new FFmpeg({ classWorkerURL });
            ffmpeg.on("log", ({ message }) => log.debug(message));
            ffmpeg.on("progress", ({ progress, time }) => {
                if (progress > 0) onStatus?.(`Encoding… ${(progress * 100).toFixed(0)}%`);
                else if (time) onStatus?.(`Encoding… ${time}s`);
            });

            await ffmpeg.load({ coreURL, wasmURL, workerURL });

            onStatus?.("FFmpeg ready");
            return ffmpeg;
        })().catch(err => {
            loadPromise = null;
            throw err;
        });
    }

    return loadPromise;
}

export async function fetchFileFromBlob(file: File) {
    const { fetchFile } = await getUtil();
    return fetchFile(file);
}
