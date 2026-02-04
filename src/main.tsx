import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import './index.css'
import './dashboard.css'
import App from './App.tsx'
import { db } from './db'
import { getStoragePartition, LOCAL_PARTITION } from './db'
import { hydrateStores } from './db/hydrate'
import { startPersist } from './db/persist'
import { triggerFullSync, startPeriodicPullCheck } from './sync'
import { useUIStore } from './store'
import { getGoogleClientId } from './auth'

async function init() {
  // In dev, unregister any existing PWA service worker so we don't get Workbox
  // "No route found" / "Precaching did not find a match" for /src/* and /node_modules/.vite/*
  if (import.meta.env.DEV && 'serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations()
    for (const reg of regs) reg.unregister()
  }

  // Initial hydration from DB and start persist (writes store changes to IndexedDB)
  await hydrateStores(db)
  startPersist(db)

  // Full sync on load when already signed in (matches extension: storedUserId => enableSyncAndTrigger on init).
  const partition = await getStoragePartition(db)
  if (partition !== LOCAL_PARTITION) {
    startPeriodicPullCheck(db)
    void triggerFullSync(db, { ignorePaused: true }).catch(() => {
      // Sync may fail (e.g. offline); status shows "Sync failed", will retry on next reload/sign-in
    })
  }

  // If a PiP-related promise rejects and our catch doesn't run, show the unsupported modal
  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event.reason?.message ?? event.reason ?? '')
    if (
      /picture-in-picture|documentPictureInPicture|requestWindow|pip/i.test(msg)
    ) {
      try {
        useUIStore.getState().setPipUnsupportedModalOpen(true)
      } catch (_) {}
      event.preventDefault?.()
    }
  })

  const clientId = getGoogleClientId()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <GoogleOAuthProvider clientId={clientId}>
        <App />
      </GoogleOAuthProvider>
    </StrictMode>,
  )
}

init()
