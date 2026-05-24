import { compressImage, isCompressibleImage } from "./image";
import { compressVideo, isCompressibleVideo } from "./video";

export interface CompressOptions {
    maxBytes: number;
    compressImages: boolean;
    compressVideos: boolean;
    onStatus?: (message: string) => void;
}

export function needsCompression(file: File, maxBytes: number): boolean {
    return file.size > maxBytes;
}

export async function compressFile(file: File, options: CompressOptions): Promise<File> {
    const { maxBytes, compressImages, compressVideos, onStatus } = options;

    if (file.size <= maxBytes) return file;

    if (compressVideos && isCompressibleVideo(file)) {
        onStatus?.("Compressing video…");
        return compressVideo(file, maxBytes, onStatus);
    }

    if (compressImages && isCompressibleImage(file)) {
        onStatus?.("Compressing image…");
        return compressImage(file, maxBytes);
    }

    throw new Error(
        `No compressor available for "${file.name}". Videos and images are supported; other file types cannot be shrunk enough in-browser.`
    );
}

export { isCompressibleImage, isCompressibleVideo };
