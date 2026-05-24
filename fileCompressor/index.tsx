/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { CloudUpload } from "@vencord/discord-types";
import { findByCodeLazy } from "@webpack";
import { showToast, Toasts, useState } from "@webpack/common";

import { CompressIcon, makeCompressAttachButton } from "./CompressAttachButton";
import { compressFile, needsCompression } from "./compression";
import { startFileInputCapture, stopFileInputCapture } from "./fileInputCapture";
import { formatBytes, LimitMode, resolveTargetBytes } from "./utils/limits";
import {
    applyFile,
    installUploadHooks,
    removeUploadHooks,
    willCompressFile,
    type FileCompressorApi
} from "./uploadHooks";

const log = new Logger("FileCompressor");

const ActionBarIcon = findByCodeLazy("Children.map", "isValidElement", "dangerous:");

const COMPRESS_SYMBOL = Symbol("vcFileCompressor");
const COMPRESSING_SYMBOL = Symbol("vcFileCompressorBusy");

const settings = definePluginSettings({
    enabledByDefault: {
        description: "Automatically compress oversized attachments",
        type: OptionType.BOOLEAN,
        default: true,
    },
    interceptFilePicker: {
        description: "Intercept the normal + attach file picker and compress before adding (recommended)",
        type: OptionType.BOOLEAN,
        default: true,
    },
    limitMode: {
        description: "Target upload size limit",
        type: OptionType.SELECT,
        options: [
            { label: "Auto (from your Nitro tier)", value: LimitMode.Auto, default: true },
            { label: "Free — 10 MB", value: LimitMode.Free10 },
            { label: "Free — 25 MB", value: LimitMode.Free25 },
            { label: "Nitro Basic — 50 MB", value: LimitMode.NitroBasic50 },
            { label: "Nitro — 500 MB", value: LimitMode.Nitro500 },
            { label: "Custom", value: LimitMode.Custom },
        ],
    },
    customLimitMb: {
        description: "Custom limit (MB) when mode is Custom",
        type: OptionType.NUMBER,
        default: 10,
    },
    safetyMargin: {
        description: "Use this fraction of the limit (0.95 = 5% headroom)",
        type: OptionType.SLIDER,
        default: 0.95,
        markers: [0.85, 0.9, 0.95, 1],
    },
    compressImages: {
        description: "Compress large images (JPEG re-encode)",
        type: OptionType.BOOLEAN,
        default: true,
    },
    compressVideos: {
        description: "Compress large videos with ffmpeg.wasm (slow, ~31 MB download once)",
        type: OptionType.BOOLEAN,
        default: true,
    },
    showHookStatus: {
        description: "Toast on startup with plugin status",
        type: OptionType.BOOLEAN,
        default: true,
    },
}, {
    customLimitMb: {
        disabled() { return this.store.limitMode !== LimitMode.Custom; },
    },
});

function getUploadFile(upload: CloudUpload): File | null {
    return upload.item?.file ?? null;
}

function makeApi(): FileCompressorApi {
    return {
        getTargetBytes: () => plugin.getTargetBytes(),
        isEnabled: () => settings.store.enabledByDefault,
        get compressImages() { return settings.store.compressImages; },
        get compressVideos() { return settings.store.compressVideos; },
    };
}

const plugin = definePlugin({
    name: "FileCompressor",
    description: "Compress videos and images to fit Discord upload limits. Use the chat bar “compress” button for large files.",
    authors: [{ name: "Marex", id: 0n }],
    tags: ["Utility", "Media"],
    dependencies: ["ChatInputButtonAPI"],

    settings,

    chatBarButton: {
        icon: CompressIcon,
        render: makeCompressAttachButton(makeApi),
    },

    patches: [
        {
            find: "UPLOAD_FILE_LIMIT_ERROR",
            replacement: [
                {
                    match: /if\((\i)\.size>(\i)\)/,
                    replace: "if($1.size>$2&&!$self.willCompressFile($1,$2))",
                },
                {
                    match: /(\i)\.size>(\i)\)/,
                    replace: "$1.size>$2&&!$self.willCompressFile($1,$2))",
                    noWarn: true,
                },
            ],
        },
        {
            find: "attachmentTooLarge",
            replacement: {
                match: /if\((\i)\.size>(\i)\)/,
                replace: "if($1.size>$2&&!$self.willCompressFile($1,$2))",
                noWarn: true,
            },
        },
        {
            find: "async uploadFiles(",
            replacement: {
                match: /async uploadFiles\((\i)\)\{/,
                replace: "async uploadFiles($1){await $self.prepareUploads($1);",
            },
        },
        {
            find: "#{intl::ATTACHMENT_UTILITIES_SPOILER}",
            replacement: {
                match: /(?<=children:\[)(?=.{10,80}tooltip:.{0,100}#{intl::ATTACHMENT_UTILITIES_SPOILER})/,
                replace: "$self.CompressButton(arguments[0]),",
            },
        },
    ],

    willCompressFile(file: File, discordLimit: number) {
        return willCompressFile(file, discordLimit, makeApi());
    },

    start() {
        console.info("[FileCompressor] Plugin starting");

        const hooksOk = installUploadHooks(makeApi());

        if (settings.store.interceptFilePicker) {
            startFileInputCapture(makeApi());
        }

        log.info("Hooks:", hooksOk, "| file capture:", settings.store.interceptFilePicker);
        console.info("[FileCompressor] Hooks:", hooksOk, "| intercept picker:", settings.store.interceptFilePicker);

        if (settings.store.showHookStatus) {
            showToast(
                hooksOk
                    ? "FileCompressor ready — use the chart icon next to + to attach large videos"
                    : "FileCompressor: partial init — use the chart button next to + in chat",
                hooksOk ? Toasts.Type.SUCCESS : Toasts.Type.MESSAGE
            );
        }
    },

    stop() {
        stopFileInputCapture();
        removeUploadHooks();
    },

    getTargetBytes() {
        return resolveTargetBytes(
            settings.store.limitMode,
            settings.store.customLimitMb,
            settings.store.safetyMargin
        );
    },

    shouldCompress(upload: CloudUpload): boolean {
        if (upload[COMPRESS_SYMBOL] === false) return false;
        if (upload[COMPRESS_SYMBOL] === true) return true;
        return settings.store.enabledByDefault;
    },

    async prepareUploads(uploads: CloudUpload[]) {
        for (const upload of uploads) {
            if (upload[COMPRESSING_SYMBOL]) {
                await this.waitForCompress(upload);
            }
            await this.compressUpload(upload);
        }
    },

    waitForCompress(upload: CloudUpload): Promise<void> {
        return new Promise(resolve => {
            const check = () => {
                if (!upload[COMPRESSING_SYMBOL]) return resolve();
                setTimeout(check, 100);
            };
            check();
        });
    },

    async compressUpload(upload: CloudUpload): Promise<void> {
        const file = getUploadFile(upload);
        if (!file || !this.shouldCompress(upload)) return;

        const maxBytes = this.getTargetBytes();
        if (!needsCompression(file, maxBytes)) return;

        if (upload[COMPRESSING_SYMBOL]) return;
        upload[COMPRESSING_SYMBOL] = true;

        try {
            const compressed = await compressFile(file, {
                maxBytes,
                compressImages: settings.store.compressImages,
                compressVideos: settings.store.compressVideos,
                onStatus: msg => showToast(msg, Toasts.Type.MESSAGE),
            });

            applyFile(upload, compressed);
            upload[COMPRESS_SYMBOL] = true;

            showToast(
                `Compressed ${upload.filename}: ${formatBytes(file.size)} → ${formatBytes(compressed.size)}`,
                Toasts.Type.SUCCESS
            );
        } catch (err) {
            log.error("Compression failed", err);
            showToast(
                err instanceof Error ? err.message : "Compression failed",
                Toasts.Type.FAILURE
            );
            upload[COMPRESS_SYMBOL] = false;
        } finally {
            upload[COMPRESSING_SYMBOL] = false;
        }
    },

    CompressButton: ErrorBoundary.wrap(({ upload }: { upload: CloudUpload; }) => {
        const [enabled, setEnabled] = useState(
            upload[COMPRESS_SYMBOL] ?? settings.store.enabledByDefault
        );
        const [busy, setBusy] = useState(false);

        const file = getUploadFile(upload);
        const overLimit = file ? needsCompression(file, plugin.getTargetBytes()) : false;

        async function onClick() {
            const next = !enabled;
            upload[COMPRESS_SYMBOL] = next;
            setEnabled(next);

            if (next && overLimit) {
                setBusy(true);
                await plugin.compressUpload(upload);
                setBusy(false);
            }
        }

        if (!file) return null;

        return (
            <ActionBarIcon
                tooltip={busy ? "Compressing…" : enabled ? "Compression on" : "Compression off"}
                onClick={onClick}
                disabled={busy}
            >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
                    <path
                        fill="currentColor"
                        d="M4 9h4v11H4V9zm6-4h4v15h-4V5zm6 7h4v8h-4v-8z"
                        opacity={enabled ? 1 : 0.35}
                    />
                </svg>
            </ActionBarIcon>
        );
    }, { noop: true }),
});

export default plugin;
