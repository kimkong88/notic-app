import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import "./index.css";
import "./dashboard.css";
import App from "./App.tsx";
import { db } from "./db";
import { getStoragePartition, LOCAL_PARTITION } from "./db";
import { hydrateStores } from "./db/hydrate";
import { startPersist } from "./db/persist";
import {
    triggerFullSync,
    startPeriodicPullCheck,
    resetSyncState,
} from "./sync";
import { useUIStore } from "./store";
import { getGoogleClientId } from "./auth";
import { trackEvent } from "./analytics";

async function init() {
    // In dev, unregister any existing PWA service worker so we don't get Workbox
    // "No route found" / "Precaching did not find a match" for /src/* and /node_modules/.vite/*
    if (import.meta.env.DEV && "serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const reg of regs) reg.unregister();
    }

    // Initial hydration from DB and start persist (writes store changes to IndexedDB)
    await hydrateStores(db);
    startPersist(db);

    // Start sync when not in local-only mode (i.e., user is signed in and has sync capability).
    // Partition represents sync mode: "local" = local-only, user-id = sync-capable.
    const partition = await getStoragePartition(db);
    const isLocalMode = partition === LOCAL_PARTITION;

    if (isLocalMode) {
        // Reset sync state to idle when in local-only mode (no sync capability)
        resetSyncState();
    } else {
        startPeriodicPullCheck(db);
        // Only trigger sync if online - avoid unnecessary failed API calls when offline
        if (navigator.onLine) {
            void triggerFullSync(db).catch(() => {
                // Sync may fail (e.g. offline or paused); status shows "Sync failed", will retry on next reload/sign-in
            });
        }
    }

    // If a PiP-related promise rejects and our catch doesn't run, fall back to editor modal
    window.addEventListener("unhandledrejection", (event) => {
        const msg = String(event.reason?.message ?? event.reason ?? "");
        if (
            /picture-in-picture|documentPictureInPicture|requestWindow|pip/i.test(
                msg
            )
        ) {
            try {
                useUIStore.getState().setEditorModalOpen(true);
            } catch (_) {}
            event.preventDefault?.();
        }
    });

    // Capture PWA install prompt (beforeinstallprompt event)
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault(); // Prevent default browser install prompt
        useUIStore.getState().setInstallPromptEvent(e);
    });

    // Detect when app is installed (hide install UI)
    window.addEventListener("appinstalled", () => {
        trackEvent("app_installed");
        useUIStore.getState().setInstallPromptEvent(null);
        useUIStore.getState().setInstallBarDismissed(true);
    });

    const clientId = getGoogleClientId();
    createRoot(document.getElementById("root")!).render(
        <StrictMode>
            <GoogleOAuthProvider clientId={clientId}>
                <App />
            </GoogleOAuthProvider>
        </StrictMode>
    );
}

init();
