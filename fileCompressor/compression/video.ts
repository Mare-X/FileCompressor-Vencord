import { fetchFileFromBlob, getFfmpeg } from "./ffmpegLoader";
import { compressVideoMediaRecorder, isWorkerBlockedError } from "./videoMediaRecorder";

const VIDEO_TYPES = /^video\//i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|flv|wmv)$/i;

export function isCompressibleVideo(file: File): boolean {
    return VIDEO_TYPES.test(file.type) || VIDEO_EXT.test(file.name);
}

function extFromName(name: string): string {
    const m = name.match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : "mp4";
}

async function probeDurationSec(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.preload = "metadata";
        video.onloadedmetadata = () => {
            const d = video.duration;
            URL.revokeObjectURL(url);
            resolve(Number.isFinite(d) && d > 0 ? d : 60);
        };
        video.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("Could not read video metadata"));
        };
        video.src = url;
    });
}

function buildVideoArgs(
    targetSizeMb: number,
    durationSec: number,
    inputName: string,
    outputName: string
): string[] {
    const targetKb = targetSizeMb * 1024;
    const audioKbps = 128;
    const bitrateKbps = Math.max(
        200,
        Math.floor(((targetKb * 8) / durationSec) * 0.92 - audioKbps)
    );
    const buf = bitrateKbps * 2;
    const scale = targetSizeMb >= 50 ? "1920:1080:force_original_aspect_ratio=decrease" : "1280:720:force_original_aspect_ratio=decrease";

    return [
        "-i", inputName,
        "-vf", `scale=${scale}`,
        "-r", "30",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-b:v", `${bitrateKbps}k`,
        "-maxrate", `${bitrateKbps}k`,
        "-bufsize", `${buf}k`,
        "-c:a", "aac",
        "-b:a", `${audioKbps}k`,
        "-movflags", "+faststart",
        "-y",
        outputName,
    ];
}

async function compressVideoFfmpeg(
    file: File,
    maxBytes: number,
    onStatus?: (message: string) => void
): Promise<File> {
    const ffmpeg = await getFfmpeg(onStatus);
    const duration = await probeDurationSec(file);
    const targetMb = maxBytes / (1024 * 1024);
    const inputExt = extFromName(file.name);
    const inputName = `input.${inputExt}`;
    const outputName = "output.mp4";

    onStatus?.("Preparing video…");
    await ffmpeg.writeFile(inputName, await fetchFileFromBlob(file));

    let args = buildVideoArgs(targetMb, duration, inputName, outputName);
    await ffmpeg.exec(args);

    let data = await ffmpeg.readFile(outputName);
    let outBytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

    if (outBytes.byteLength > maxBytes) {
        onStatus?.("Still too large, re-encoding with lower bitrate…");
        const lowerMb = targetMb * 0.75;
        args = buildVideoArgs(lowerMb, duration, inputName, outputName);
        await ffmpeg.exec(args);
        data = await ffmpeg.readFile(outputName);
        outBytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    }

    try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
    } catch {
        // ignore cleanup errors
    }

    if (outBytes.byteLength > maxBytes) {
        throw new Error("Video is still too large after FFmpeg. Try a shorter clip.");
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
    return new File([outBytes], `${baseName}.mp4`, { type: "video/mp4" });
}

export async function compressVideo(
    file: File,
    maxBytes: number,
    onStatus?: (message: string) => void
): Promise<File> {
    try {
        return await compressVideoFfmpeg(file, maxBytes, onStatus);
    } catch (err) {
        if (!isWorkerBlockedError(err)) throw err;

        onStatus?.("FFmpeg worker blocked — using browser encoder instead…");
        return compressVideoMediaRecorder(file, maxBytes, onStatus);
    }
}
