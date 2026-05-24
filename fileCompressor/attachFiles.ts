import { Logger } from "@utils/Logger";
import { chooseFile } from "@utils/web";
import { findByPropsLazy } from "@webpack";
import { DraftType, SelectedChannelStore } from "@webpack/common";
/** WEB platform id for CloudUpload */
const WEB_PLATFORM = 1;

import type { FileCompressorApi } from "./uploadHooks";
import { canCompressFile, compressOneFile } from "./uploadHooks";

const log = new Logger("FileCompressor");

const UploadManager = findByPropsLazy("addFiles", "clearAll");

export async function compressFilesForUpload(files: File[], api: FileCompressorApi): Promise<File[]> {
    const maxBytes = api.getTargetBytes();
    const out: File[] = [];

    for (const file of files) {
        if (canCompressFile(file, maxBytes, api)) {
            out.push(await compressOneFile(file, api));
        } else {
            out.push(file);
        }
    }

    return out;
}

export function attachFilesToDraft(files: File[], channelId?: string | null) {
    const id = channelId ?? SelectedChannelStore.getChannelId();
    if (!id) {
        log.warn("No channel to attach files to");
        return false;
    }

    if (!UploadManager?.addFiles) {
        log.error("UploadManager.addFiles missing");
        return false;
    }

    UploadManager.addFiles({
        channelId: id,
        draftType: DraftType.ChannelMessage,
        files: files.map(file => ({
            file,
            platform: WEB_PLATFORM,
        })),
        showLargeMessageDialog: false,
    });

    return true;
}

export async function pickCompressAndAttach(api: FileCompressorApi, channelId?: string | null) {
    const file = await chooseFile("video/*,image/*,.mp4,.webm,.mov,.mkv,.jpg,.jpeg,.png,.webp,.gif");
    if (!file) return;

    const maxBytes = api.getTargetBytes();
    const toAttach = canCompressFile(file, maxBytes, api)
        ? await compressOneFile(file, api)
        : file;

    if (!attachFilesToDraft([toAttach], channelId)) {
        throw new Error("Could not attach file — UploadManager unavailable");
    }
}
