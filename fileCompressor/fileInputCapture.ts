import { Logger } from "@utils/Logger";

import { attachFilesToDraft, compressFilesForUpload } from "./attachFiles";
import type { FileCompressorApi } from "./uploadHooks";
import { canCompressFile } from "./uploadHooks";

const log = new Logger("FileCompressor/Capture");

let apiRef: FileCompressorApi | null = null;
let busy = false;

function shouldIntercept(files: File[], api: FileCompressorApi): boolean {
    if (!api.isEnabled() || busy) return false;
    const maxBytes = api.getTargetBytes();
    return files.some(f => canCompressFile(f, maxBytes, api));
}

async function handleFiles(files: File[]) {
    if (!apiRef || !files.length) return;

    busy = true;
    try {
        log.info("Intercepted file picker:", files.map(f => `${f.name} (${f.size})`).join(", "));
        const compressed = await compressFilesForUpload(files, apiRef);
        attachFilesToDraft(compressed);
    } catch (e) {
        log.error("Intercept handler failed", e);
    } finally {
        busy = false;
    }
}

function onChangeCapture(e: Event) {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    if (!input.files?.length || !apiRef) return;

    const files = Array.from(input.files);
    if (!shouldIntercept(files, apiRef)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Prevent Discord from reading the oversized file from this input.
    const snapshot = files;
    input.value = "";

    void handleFiles(snapshot);
}

export function startFileInputCapture(api: FileCompressorApi) {
    apiRef = api;
    document.addEventListener("change", onChangeCapture, true);
    log.info("File input capture listener active");
}

export function stopFileInputCapture() {
    document.removeEventListener("change", onChangeCapture, true);
    apiRef = null;
}
