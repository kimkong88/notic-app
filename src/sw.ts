/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// Precache all files generated during build
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches
cleanupOutdatedCaches();

// Skip waiting and claim clients immediately
self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});

// Serve index.html for navigation requests (SPA offline-first)
registerRoute(
    new NavigationRoute(
        // @ts-ignore - createHandlerBoundToURL exists but TS doesn't know
        new NetworkFirst({
            cacheName: "notic-pages",
            networkTimeoutSeconds: 1,
            plugins: [
                new ExpirationPlugin({
                    maxEntries: 32,
                    maxAgeSeconds: 24 * 60 * 60,
                }),
            ],
        }),
        {
            denylist: [
                /^\/api\//,
                /^https:\/\//,
                /^\/src\//,
                /^\/node_modules\//,
                /^\/@vite\//,
                /^\/@id\//,
            ],
        }
    )
);

// Cache assets (JS, CSS, images, etc.)
registerRoute(
    ({ sameOrigin, request }) =>
        sameOrigin && request.destination !== "document",
    new CacheFirst({
        cacheName: "notic-assets",
        plugins: [
            new ExpirationPlugin({
                maxEntries: 64,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
            }),
        ],
    })
);

// Cache all same-origin requests
registerRoute(
    ({ sameOrigin }) => sameOrigin,
    new NetworkFirst({
        cacheName: "notic-pages",
        networkTimeoutSeconds: 1,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 32,
                maxAgeSeconds: 24 * 60 * 60,
            }),
        ],
    })
);
