/**
 * Google auth for SPA: decode credential (JWT), persist last user for offline.
 * Uses VITE_GOOGLE_CLIENT_ID from env. No client secret in frontend (SPA).
 */

import type { NoticDB } from "../db/schema";
import { PREFS_KEYS } from "../db/prefs-keys";
import type { GoogleUserProfile } from "../store/useAuthStore";

/** Decode JWT payload without verification (we only need profile for display; backend can verify if needed). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return null;
        const payload = parts[1];
        const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const json = atob(base64);
        return JSON.parse(json) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Parse Google credential (JWT from GIS) into profile for display and persist.
 * JWT payload has sub, email, name, picture.
 */
export function decodeGoogleCredential(
    credential: string
): GoogleUserProfile | null {
    const payload = decodeJwtPayload(credential);
    if (!payload || typeof payload.sub !== "string") return null;
    const name = typeof payload.name === "string" ? payload.name : "";
    const picture = typeof payload.picture === "string" ? payload.picture : "";
    if (!name || !picture) return null;
    return {
        sub: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
        name,
        picture,
    };
}

/**
 * Fetch an image URL and return as a base64 data URL so it can be shown offline.
 * Returns null on failure (CORS, network, or non-OK response).
 */
export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
    if (!url || url.startsWith("data:")) return null;
    try {
        const res = await fetch(url, { mode: "cors", credentials: "omit" });
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.type.startsWith("image/")) return null;
        return await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () =>
                resolve(
                    typeof reader.result === "string" ? reader.result : null
                );
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

/**
 * Persist last user to IndexedDB so app shows "Signed in as X" when offline.
 * If profile.picture is an HTTP(S) URL, we try to store it as a base64 data URL
 * so the avatar can be shown without network. On failure we keep the URL.
 */
export async function persistLastUser(
    db: NoticDB,
    profile: GoogleUserProfile
): Promise<void> {
    let picture = profile.picture;
    if (
        picture &&
        (picture.startsWith("http://") || picture.startsWith("https://"))
    ) {
        const dataUrl = await fetchImageAsDataUrl(picture);
        if (dataUrl) picture = dataUrl;
    }
    await db.prefs.put({
        key: PREFS_KEYS.authLastUser,
        value: { ...profile, picture },
    });
}

/** Clear last user from IndexedDB (on sign out). */
export async function clearLastUser(db: NoticDB): Promise<void> {
    await db.prefs.delete(PREFS_KEYS.authLastUser);
}

export function getGoogleClientId(): string {
    const id = import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
    return (id && id.trim()) || "";
}

const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

/**
 * Fetch Google profile from access token (for implicit flow).
 * Returns profile for display and persist; used when we trigger login from our own button.
 */
export async function fetchGoogleProfileFromToken(
    accessToken: string
): Promise<GoogleUserProfile | null> {
    const res = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
        sub?: string;
        email?: string;
        name?: string;
        picture?: string;
    };
    if (
        typeof data?.sub !== "string" ||
        typeof data?.name !== "string" ||
        typeof data?.picture !== "string"
    ) {
        return null;
    }
    return {
        sub: data.sub,
        email: typeof data.email === "string" ? data.email : undefined,
        name: data.name,
        picture: data.picture,
    };
}
