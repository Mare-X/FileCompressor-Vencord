import { UserStore } from "@webpack/common";

/** Discord upload caps by Nitro tier (bytes). */
const PREMIUM_LIMITS: Record<number, number> = {
    0: 10 * 1024 * 1024,
    1: 50 * 1024 * 1024,
    2: 500 * 1024 * 1024,
};

export enum LimitMode {
    Auto = 0,
    Free10 = 1,
    Free25 = 2,
    NitroBasic50 = 3,
    Nitro500 = 4,
    Custom = 5,
}

const MODE_BYTES: Record<LimitMode, number | null> = {
    [LimitMode.Auto]: null,
    [LimitMode.Free10]: 10 * 1024 * 1024,
    [LimitMode.Free25]: 25 * 1024 * 1024,
    [LimitMode.NitroBasic50]: 50 * 1024 * 1024,
    [LimitMode.Nitro500]: 500 * 1024 * 1024,
    [LimitMode.Custom]: null,
};

export function getPremiumType(): number {
    return UserStore.getCurrentUser()?.premiumType ?? 0;
}

export function getAutoLimitBytes(): number {
    return PREMIUM_LIMITS[getPremiumType()] ?? PREMIUM_LIMITS[0];
}

export function resolveTargetBytes(mode: LimitMode, customMb: number, safetyMargin: number): number {
    let limit: number;

    if (mode === LimitMode.Auto) {
        limit = getAutoLimitBytes();
    } else if (mode === LimitMode.Custom) {
        limit = Math.max(1, customMb) * 1024 * 1024;
    } else {
        limit = MODE_BYTES[mode] ?? getAutoLimitBytes();
    }

    const margin = Math.min(Math.max(safetyMargin, 0.5), 1);
    return Math.floor(limit * margin);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
