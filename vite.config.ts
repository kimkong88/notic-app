import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// COOP header so opener can check OAuth popup (window.closed). Required for Google sign-in popup.
const COOP_HEADER = 'Cross-Origin-Opener-Policy'
const COOP_VALUE = 'same-origin-allow-popups'

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
      name: 'coop-header',
      configureServer(server) {
        server.middlewares.use((_req, res, next) => {
          res.setHeader(COOP_HEADER, COOP_VALUE)
          next()
        })
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'inline',
      manifest: {
        name: 'Notic',
        short_name: 'Notic',
        description: 'Notes and sync',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f172a',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        // Ensure manifest and favicon are precached (build output)
        additionalManifestEntries: [
          { url: '/manifest.webmanifest', revision: null },
          { url: '/logo.svg', revision: null },
        ],
        // Serve index.html for any navigation when offline (SPA offline-first)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /^https:\/\//,
          /^\/src\//,
          /^\/node_modules\//,
          /^\/@vite\//,
          /^\/@id\//,
        ],
        // Cache same-origin requests at runtime so dev and any missed assets work offline after first load
        runtimeCaching: [
          {
            urlPattern: ({ sameOrigin, request }) => sameOrigin && request.destination !== 'document',
            handler: 'CacheFirst',
            options: {
              cacheName: 'notic-assets',
              expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ sameOrigin }) => sameOrigin,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'notic-pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        // Disable SW in dev: Vite serves /src/* and /@vite/* URLs that can't be precached,
        // so the SW would log "No route found" for every request and break offline anyway.
        // Test offline with: npm run build && npm run preview (then refresh while offline).
        enabled: false,
      },
    }),
  ],
})
