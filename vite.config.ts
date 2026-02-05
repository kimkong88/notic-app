import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// COOP header so opener can check OAuth popup (window.closed). Required for Google sign-in popup.
const COOP_HEADER = "Cross-Origin-Opener-Policy";
const COOP_VALUE = "same-origin-allow-popups";

// https://vite.dev/config/
export default defineConfig({
    server: {
        headers: {
            [COOP_HEADER]: COOP_VALUE,
        },
    },
    plugins: [
        react(),
        tailwindcss(),
        // Ensure COOP is set on every dev response (server.headers can miss HTML in some setups)
        {
            name: "coop-header",
            configureServer(server) {
                server.middlewares.use((_req, res, next) => {
                    res.setHeader(COOP_HEADER, COOP_VALUE);
                    next();
                });
            },
        },
        VitePWA({
            strategies: "injectManifest",
            srcDir: "src",
            filename: "sw.ts",
            registerType: "autoUpdate",
            injectRegister: "inline",
            manifest: {
                name: "Notic",
                short_name: "Notic",
                description: "Your floating notepad. Always accessible.",
                start_url: "/",
                display: "standalone",
                background_color: "#ffffff",
                theme_color: "#4f46e5",
                icons: [
                    {
                        src: "/logo.svg",
                        sizes: "any",
                        type: "image/svg+xml",
                        purpose: "any maskable",
                    },
                ],
            },
            injectManifest: {
                // Glob handles most files, but exclude logo.svg and manifest.webmanifest
                // since vite-plugin-pwa adds them automatically
                globPatterns: [
                    "**/*.{js,css,html,ico,png,svg,woff2,webmanifest}",
                ],
                globIgnores: ["**/logo.svg", "**/manifest.webmanifest"],
            },
            devOptions: {
                // Disable SW in dev: Vite serves /src/* and /@vite/* URLs that can't be precached,
                // so the SW would log "No route found" for every request and break offline anyway.
                // Test offline with: npm run build && npm run preview (then refresh while offline).
                enabled: false,
            },
        }),
    ],
});
