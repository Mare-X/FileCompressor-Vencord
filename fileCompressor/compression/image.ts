const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|bmp)$/i;

export function isCompressibleImage(file: File): boolean {
    return IMAGE_TYPES.test(file.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name);
}

export async function compressImage(file: File, maxBytes: number): Promise<File> {
    const bitmap = await createImageBitmap(file);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";

    let scale = 1;
    let quality = 0.9;

    try {
        for (let attempt = 0; attempt < 24; attempt++) {
            const w = Math.max(1, Math.round(bitmap.width * scale));
            const h = Math.max(1, Math.round(bitmap.height * scale));

            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas not available");

            ctx.drawImage(bitmap, 0, 0, w, h);

            const blob = await canvasToBlob(canvas, "image/jpeg", quality);
            if (blob.size <= maxBytes) {
                return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
            }

            if (quality > 0.35) {
                quality -= 0.08;
            } else if (scale > 0.35) {
                scale *= 0.85;
                quality = 0.85;
            } else {
                break;
            }
        }
    } finally {
        bitmap.close();
    }

    throw new Error(`Could not compress image below ${formatLimit(maxBytes)}`);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob(
            blob => (blob ? resolve(blob) : reject(new Error("Failed to encode image"))),
            type,
            quality
        );
    });
}

function formatLimit(bytes: number) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
