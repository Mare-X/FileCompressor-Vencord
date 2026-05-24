import { Logger } from "@utils/Logger";

const log = new Logger("FileCompressor/MediaRecorder");

function pickMimeType(): string {
    const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
    ];
    return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? "";
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

function recordOnce(file: File, videoBitsPerSecond: number, mimeType: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";

        const cleanup = () => URL.revokeObjectURL(url);

        video.onloadedmetadata = () => {
            const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
            if (!capture) {
                cleanup();
                reject(new Error("captureStream is not available in this client"));
                return;
            }

            const stream = capture.call(video);
            const videoTracks = stream.getVideoTracks();
            if (!videoTracks.length) {
                cleanup();
                reject(new Error("No video track in stream"));
                return;
            }

            let recorder: MediaRecorder;
            try {
                recorder = new MediaRecorder(stream, {
                    mimeType: mimeType || undefined,
                    videoBitsPerSecond,
                    audioBitsPerSecond: 128_000,
                });
            } catch (e) {
                cleanup();
                reject(e);
                return;
            }

            const chunks: Blob[] = [];
            recorder.ondataavailable = ev => {
                if (ev.data?.size) chunks.push(ev.data);
            };
            recorder.onerror = () => {
                cleanup();
                reject(recorder.error ?? new Error("MediaRecorder failed"));
            };
            recorder.onstop = () => {
                cleanup();
                stream.getTracks().forEach(t => t.stop());
                resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
            };

            video.onended = () => {
                if (recorder.state !== "inactive") recorder.stop();
            };

            video.play().then(() => {
                recorder.start(250);
                const ms = Math.ceil((video.duration || 60) * 1000) + 1500;
                setTimeout(() => {
                    video.pause();
                    if (recorder.state !== "inactive") recorder.stop();
                }, ms);
            }).catch(err => {
                cleanup();
                reject(err);
            });
        };

        video.onerror = () => {
            cleanup();
            reject(new Error("Failed to load video for browser encoding"));
        };
        video.src = url;
    });
}

export async function compressVideoMediaRecorder(
    file: File,
    maxBytes: number,
    onStatus?: (message: string) => void
): Promise<File> {
    const mimeType = pickMimeType();
    if (!mimeType) {
        throw new Error("This client does not support MediaRecorder for video");
    }

    const duration = await probeDurationSec(file);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "video";
    const ext = mimeType.includes("mp4") ? "mp4" : "webm";

    let videoBps = Math.max(200_000, Math.floor((maxBytes * 8 * 0.88) / duration));

    for (let attempt = 0; attempt < 6; attempt++) {
        onStatus?.(`Browser encode (attempt ${attempt + 1})…`);
        log.info(`MediaRecorder attempt ${attempt + 1}, ${videoBps} bps`);

        const blob = await recordOnce(file, videoBps, mimeType);
        if (blob.size <= maxBytes) {
            return new File([blob], `${baseName}.${ext}`, { type: blob.type });
        }

        videoBps = Math.floor(videoBps * 0.7);
    }

    throw new Error("Video is still too large after browser encoding. Try a shorter clip.");
}

export function isWorkerBlockedError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    return err.name === "SecurityError"
        || /Worker/i.test(err.message)
        || /cannot be accessed from origin/i.test(err.message);
}
