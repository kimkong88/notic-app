/**
 * Umami analytics. The app loads the Umami script in index.html, which exposes
 * window.umami. We track the same event names as the notic extension for parity.
 * See: https://umami.is/docs/track-events
 */

declare global {
  interface Window {
    umami?: {
      track: (eventName: string, eventData?: Record<string, string | number | boolean>) => void
    }
  }
}

/**
 * Send a custom event to Umami. Fire-and-forget; does not throw.
 * Event names match the notic extension: note_created, note_deleted, folder_created,
 * pip_opened, sign_in_completed, etc.
 */
export function trackEvent(
  eventName: string,
  eventData?: Record<string, string | number | boolean>
): void {
  try {
    if (typeof window !== 'undefined' && window.umami?.track) {
      if (eventData && Object.keys(eventData).length > 0) {
        window.umami.track(eventName, eventData)
      } else {
        window.umami.track(eventName)
      }
    }
  } catch {
    // ignore
  }
}
