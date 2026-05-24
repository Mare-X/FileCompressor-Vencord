import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { showToast, Toasts } from "@webpack/common";
import { CloudUpload } from "@vencord/discord-types";

import { compressFile, isCompressibleImage, isCompressibleVideo, needsCompression } from "./compression";
import { formatBytes } from "./utils/limits";

const log = new Logger("FileCompressor");

export type FileCompressorApi = {
    getTargetBytes(): number;
    isEnabled(): boolean;
    compressImages: boolean;
    compressVideos: boolean;
};

type FileEntry = { file: File; platform?: number; [key: string]: unknown };

export type AddFilesOptions = {
    channelId: string;
    draftType: number;
    files: FileEntry[];
    showLargeMessageDialog?: boolean;
    [key: string]: unknown;
};

let originalAddFiles: ((opts: AddFilesOptions) => unknown) | null = null;
let hooked = false;

const UploadManager = findByPropsLazy("addFiles", "clearAll");

export function isHooked() {
    return hooked && originalAddFiles != null;
}

export function canCompressFile(file: File, maxBytes: number, api: FileCompressorApi): boolean {
    if (!api.isEnabled()) return false;
    if (!needsCompression(file, maxBytes)) return false;
    if (api.compressVideos && isCompressibleVideo(file)) return true;
    if (api.compressImages && isCompressibleImage(file)) return true;
    return false;
}

/** Used by patch: skip Discord's "file too large" dialog when we can compress instead. */
export function willCompressFile(file: File, discordLimit: number, api: FileCompressorApi): boolean {
    const target = api.getTargetBytes();
    if (!canCompressFile(file, target, api)) return false;
    return file.size > discordLimit || file.size > target;
}

export async function compressOneFile(file: File, api: FileCompressorApi): Promise<File> {
    const maxBytes = api.getTargetBytes();
    showToast(`Compressing ${file.name} (${formatBytes(file.size)})…`, Toasts.Type.MESSAGE);
    const compressed = await compressFile(file, {
        maxBytes,
        compressImages: api.compressImages,
        compressVideos: api.compressVideos,
        onStatus: msg => showToast(msg, Toasts.Type.MESSAGE),
    });
    showToast(
        `Done: ${file.name} → ${formatBytes(compressed.size)}`,
        Toasts.Type.SUCCESS
    );
    return compressed;
}

async function processAddFilesOpts(opts: AddFilesOptions, api: FileCompressorApi): Promise<AddFilesOptions> {
    if (!api.isEnabled() || !opts?.files?.length) return opts;

    const newFiles: FileEntry[] = [];
    for (const entry of opts.files) {
        const file = entry?.file;
        if (!file) {
            newFiles.push(entry);
            continue;
        }
        if (canCompressFile(file, api.getTargetBytes(), api)) {
            newFiles.push({ ...entry, file: await compressOneFile(file, api) });
        } else {
            newFiles.push(entry);
        }
    }
    return { ...opts, files: newFiles };
}

export async function addFilesEntry(opts: AddFilesOptions, api: FileCompressorApi) {
    if (!originalAddFiles) {
        log.error("addFiles hook missing");
        return UploadManager.addFiles(opts);
    }
    try {
        const processed = await processAddFilesOpts(opts, api);
        return originalAddFiles.call(UploadManager, processed);
    } catch {
        return;
    }
}

export function installUploadHooks(api: FileCompressorApi): boolean {
    let ok = true;

    if (UploadManager?.addFiles && !originalAddFiles) {
        originalAddFiles = UploadManager.addFiles;
        UploadManager.addFiles = (opts: AddFilesOptions) => addFilesEntry(opts, api);
        log.info("Hooked UploadManager.addFiles");
    } else if (!UploadManager?.addFiles) {
        log.warn("UploadManager.addFiles not found");
        ok = false;
    }

    hooked = ok;
    return ok;
}

export function removeUploadHooks() {
    if (UploadManager && originalAddFiles) {
        UploadManager.addFiles = originalAddFiles;
        originalAddFiles = null;
    }
    hooked = false;
}

export function applyFile(upload: CloudUpload, file: File) {
    upload.item.file = file;
    upload.filename = file.name;
    if (file.type) upload.mimeType = file.type;
    upload.preCompressionSize = file.size;
}
