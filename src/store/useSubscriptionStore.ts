/**
 * Subscription status (Pro/Free) from backend GET /billing/status.
 * Persisted to IndexedDB prefs; refreshed when signed in and on app load.
 */

import { create } from 'zustand'
import type { NoticDB } from '../db/schema'
import { PREFS_KEYS } from '../db/prefs-keys'
import { getStoredTokens } from '../api/backend'
import { getBillingStatus } from '../api/backend'

/** Free plan note limit. Over this and not Pro: app switches to Local (sync paused). Match notic extension. */
export const FREE_NOTE_LIMIT = 10

interface SubscriptionState {
  /** true = Pro, false = Free, null = unknown/loading */
  isSubscribed: boolean | null
}

interface SubscriptionActions {
  setSubscribed: (value: boolean | null) => void
  /** Fetch from backend and update store + persist. No-op when not signed in or request fails. */
  refresh: (db: NoticDB) => Promise<void>
}

export const useSubscriptionStore = create<SubscriptionState & SubscriptionActions>((set) => ({
  isSubscribed: null,

  setSubscribed: (value) => set({ isSubscribed: value }),

  refresh: async (db) => {
    const tokens = await getStoredTokens(db)
    if (!tokens?.accessToken) return
    try {
      const status = await getBillingStatus(db)
      if (status == null) return
      const hasPro =
        status.plan === 'pro' &&
        (status.expiredAt == null || status.expiredAt === '' || new Date(status.expiredAt) > new Date())
      set({ isSubscribed: hasPro })
      await db.prefs.put({ key: PREFS_KEYS.subscriptionIsPro, value: hasPro })
    } catch {
      // Offline or network error: leave store unchanged
    }
  },
}))
