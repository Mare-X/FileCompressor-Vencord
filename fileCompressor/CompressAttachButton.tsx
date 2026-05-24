import { ChatBarButton } from "@api/ChatButtons";
import { Logger } from "@utils/Logger";
import { showToast, Toasts, useState } from "@webpack/common";

import { pickCompressAndAttach } from "./attachFiles";
import type { FileCompressorApi } from "./uploadHooks";

const log = new Logger("FileCompressor");

const CompressIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path
            fill="currentColor"
            d="M4 9h4v11H4V9zm6-4h4v15h-4V5zm6 7h4v8h-4v-8z"
        />
    </svg>
);

export function makeCompressAttachButton(getApi: () => FileCompressorApi) {
    return function CompressAttachButton({ isMainChat, channel }: { isMainChat: boolean; channel: { id?: string; }; }) {
        const [busy, setBusy] = useState(false);

        if (!isMainChat) return null;

        async function onClick() {
            if (busy) return;
            setBusy(true);
            try {
                log.info("Compress & attach clicked");
                await pickCompressAndAttach(getApi(), channel?.id);
            } catch (e) {
                log.error(e);
                showToast(
                    e instanceof Error ? e.message : "Compress & attach failed",
                    Toasts.Type.FAILURE
                );
            } finally {
                setBusy(false);
            }
        }

        return (
            <ChatBarButton
                tooltip={busy ? "Compressing…" : "Compress & attach (for large videos/images)"}
                onClick={onClick}
                buttonProps={{ disabled: busy }}
            >
                <CompressIcon />
            </ChatBarButton>
        );
    };
}

export { CompressIcon };
