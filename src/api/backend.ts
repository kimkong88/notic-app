/**
 * Notic backend API client (auth + billing).
 * Uses IndexedDB prefs for tokens; syncs access token to localStorage for upload.ts.
 * Aligned with notic extension api-client (POST /auth/authenticate, GET /billing/status).
 */

import type { NoticDB } from '../db/schema'
import { PREFS_KEYS } from '../db/prefs-keys'
import { useAuthStore } from '../store/useAuthStore'
import { useSubscriptionStore } from '../store/useSubscriptionStore'
import { useUIStore } from '../store/useUIStore'

const LOCAL_STORAGE_ACCESS_KEY = 'notic_authAccessToken'

function getApiBaseUrl(): string {
  const url =
    typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_API_URL as string | undefined)
  return url && String(url).trim().length > 0 ? String(url).replace(/\/$/, '') : 'https://api.getnotic.io'
}

export interface StoredTokens {
  accessToken: string
  refreshToken: string
}

export async function getStoredTokens(db: NoticDB): Promise<StoredTokens | null> {
  const [accessRow, refreshRow] = await Promise.all([
    db.prefs.get(PREFS_KEYS.authAccessToken),
    db.prefs.get(PREFS_KEYS.authRefreshToken),
  ])
  const accessToken = typeof accessRow?.value === 'string' ? accessRow.value.trim() : ''
  const refreshToken = typeof refreshRow?.value === 'string' ? refreshRow.value.trim() : ''
  if (accessToken.length > 0 && refreshToken.length > 0) {
    return { accessToken, refreshToken }
  }
  return null
}

export async function setStoredTokens(db: NoticDB, tokens: StoredTokens): Promise<void> {
  await Promise.all([
    db.prefs.put({ key: PREFS_KEYS.authAccessToken, value: tokens.accessToken }),
    db.prefs.put({ key: PREFS_KEYS.authRefreshToken, value: tokens.refreshToken }),
  ])
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_STORAGE_ACCESS_KEY, tokens.accessToken)
    }
  } catch (_) {}
}

export async function clearStoredTokens(db: NoticDB): Promise<void> {
  await Promise.all([
    db.prefs.delete(PREFS_KEYS.authAccessToken),
    db.prefs.delete(PREFS_KEYS.authRefreshToken),
    db.prefs.delete(PREFS_KEYS.authUserId),
  ])
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_ACCESS_KEY)
    }
  } catch (_) {}
}

/**
 * POST /auth/authenticate with Google access token. On success stores backend JWT and user id.
 */
export async function authenticateWithGoogleToken(
  googleAccessToken: string,
  db: NoticDB
): Promise<boolean> {
  const base = getApiBaseUrl()
  try {
    const res = await fetch(`${base}/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: googleAccessToken, provider: 'google' }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as {
      tokens?: { access?: { token?: string }; refresh?: { token?: string } }
      user?: { id?: string }
    }
    const access = data?.tokens?.access?.token
    const refresh = data?.tokens?.refresh?.token
    if (typeof access !== 'string' || typeof refresh !== 'string') return false
    await setStoredTokens(db, { accessToken: access, refreshToken: refresh })
    const userId = data?.user?.id
    if (typeof userId === 'string' && userId.length > 0) {
      await db.prefs.put({ key: PREFS_KEYS.authUserId, value: userId })
      await db.prefs.put({ key: PREFS_KEYS.authLastUserId, value: userId })
    }
    return true
  } catch {
    return false
  }
}

/** Clear tokens, sign out, switch to local partition, and show session-expired modal. Call when 401 persists after refresh (or refresh returns 401). */
async function handleSessionExpired(db: NoticDB): Promise<void> {
  const { loadPartitionIntoStores, LOCAL_PARTITION } = await import('../db')
  const { clearLastServerSnapshot, stopPeriodicPullCheck } = await import('../sync')
  
  useAuthStore.getState().signOut()
  useSubscriptionStore.getState().setSubscribed(null)
  stopPeriodicPullCheck()
  useUIStore.getState().setServerNewerBannerVisible(false)
  clearLastServerSnapshot()
  await clearStoredTokens(db)
  await loadPartitionIntoStores(db, LOCAL_PARTITION)
  useUIStore.getState().setSessionExpiredModalOpen(true)
}

/** In-flight refresh promise to prevent concurrent refresh requests (race condition). */
let refreshPromise: Promise<boolean> | null = null

/** POST /auth/refresh; on success updates stored tokens. On 401, signs out and shows session-expired modal. Prevents concurrent refresh attempts. */
export async function refreshTokens(db: NoticDB): Promise<boolean> {
  // If refresh is already in progress, wait for it instead of starting a new one
  if (refreshPromise) {
    return refreshPromise
  }

  refreshPromise = (async () => {
    const tokens = await getStoredTokens(db)
    if (!tokens?.refreshToken) return false
    const base = getApiBaseUrl()
    try {
      const res = await fetch(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      })
      if (res.status === 401) {
        void handleSessionExpired(db)
        return false
      }
      if (!res.ok) return false
      const data = (await res.json()) as { tokens?: { access?: { token?: string }; refresh?: { token?: string } } }
      const access = data?.tokens?.access?.token
      const refresh = data?.tokens?.refresh?.token
      if (typeof access !== 'string' || typeof refresh !== 'string') return false
      await setStoredTokens(db, { accessToken: access, refreshToken: refresh })
      return true
    } catch {
      return false
    } finally {
      // Clear the promise so future calls can refresh again
      refreshPromise = null
    }
  })()

  return refreshPromise
}

type FetchWithAuthInit = RequestInit & { headers?: HeadersInit }

export async function fetchWithAuth(
  db: NoticDB,
  path: string,
  init: FetchWithAuthInit = {}
): Promise<Response> {
  const base = getApiBaseUrl()
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`
  const { headers = {}, ...rest } = init

  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const tokens = await getStoredTokens(db)
    if (!tokens?.accessToken) return { ...headers }
    return {
      ...headers,
      Authorization: `Bearer ${tokens.accessToken}`,
    }
  }

  let authHeaders = await getAuthHeaders()
  let res = await fetch(url, {
    ...rest,
    headers: {
      ...authHeaders,
      ...(rest.body && typeof rest.body === 'string' && !(authHeaders as Record<string, string>)['Content-Type']
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
  })

  if (res.status === 401) {
    const refreshed = await refreshTokens(db)
    if (refreshed) {
      authHeaders = await getAuthHeaders()
      res = await fetch(url, {
        ...rest,
        headers: {
          ...authHeaders,
          ...(rest.body && typeof rest.body === 'string' && !(authHeaders as Record<string, string>)['Content-Type']
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
      })
    }
    if (res.status === 401) {
      void handleSessionExpired(db)
    }
  }

  if (res.status >= 500) {
    useUIStore.getState().setToastMessage('Something went wrong. Please try again.')
  }

  return res
}

export interface BillingStatus {
  plan: 'free' | 'pro'
  status?: string
  expiredAt?: string | null
}

/** GET /billing/status (requires JWT). Returns real subscription from backend. */
export async function getBillingStatus(db: NoticDB): Promise<BillingStatus | null> {
  const res = await fetchWithAuth(db, '/billing/status')
  if (!res.ok) return null
  const data = (await res.json()) as { plan?: string; status?: string; expiredAt?: string | null }
  if (data?.plan === 'pro' || data?.plan === 'free') {
    return {
      plan: data.plan,
      status: data.status,
      expiredAt: data.expiredAt ?? undefined,
    }
  }
  return null
}

const BILLING_BASE = 'https://getnotic.io/billing'

/**
 * POST /auth/billing-link (requires JWT). Returns short-lived billing token and redirect URL.
 * Used to open the billing page with ?token=... so getnotic.io/billing can auth without Google login (match extension).
 */
export async function getBillingLink(db: NoticDB): Promise<{ redirectUrl: string; billingToken: string; expiresAt: string } | null> {
  const res = await fetchWithAuth(db, '/auth/billing-link', { method: 'POST' })
  if (!res.ok) return null
  const data = (await res.json()) as { redirectUrl?: string; billingToken?: string; expiresAt?: string }
  if (typeof data?.redirectUrl === 'string' && typeof data?.billingToken === 'string') {
    return {
      redirectUrl: data.redirectUrl,
      billingToken: data.billingToken,
      expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
    }
  }
  return null
}

/**
 * Open billing page: with token when signed in (so billing page can identify user), plain /billing when not.
 * Match extension openBillingOrUpgrade. Call from Settings plan link and Upgrade CTAs.
 */
export async function openBillingPage(db: NoticDB, onToast?: (message: string) => void): Promise<void> {
  const tokens = await getStoredTokens(db)
  if (!tokens) {
    window.open(BILLING_BASE, '_blank', 'noopener,noreferrer')
    return
  }
  const link = await getBillingLink(db)
  if (!link?.redirectUrl || !link?.billingToken) {
    onToast?.('Could not open billing page. Please try again.')
    return
  }
  const url = link.redirectUrl.includes('localhost')
    ? `${BILLING_BASE}?token=${encodeURIComponent(link.billingToken)}`
    : link.redirectUrl
  window.open(url, '_blank', 'noopener,noreferrer')
}

/**
 * POST /publish (requires JWT). Publish a note to the web; returns shareCode and shareUrl.
 * Returns paymentRequired: true when backend returns 402 (Pro required). Match extension api-client.
 */
export type PublishNoteResult =
  | { shareCode: string; shareUrl: string }
  | { paymentRequired: true }
  | null

export async function publishNote(db: NoticDB, clientId: string): Promise<PublishNoteResult> {
  const res = await fetchWithAuth(db, '/publish', {
    method: 'POST',
    body: JSON.stringify({ clientId }),
  })
  if (res.status === 402) return { paymentRequired: true }
  if (!res.ok) return null
  const data = (await res.json()) as { shareCode?: string; shareUrl?: string }
  if (typeof data?.shareCode === 'string' && typeof data?.shareUrl === 'string') {
    return { shareCode: data.shareCode, shareUrl: data.shareUrl }
  }
  return null
}

/**
 * DELETE /publish (requires JWT). Unpublish a note (clear share code).
 * Returns paymentRequired: true when backend returns 402 (Pro required). Match extension api-client.
 */
export async function unpublishNote(
  db: NoticDB,
  clientId: string
): Promise<{ ok: boolean; paymentRequired?: boolean }> {
  const res = await fetchWithAuth(db, '/publish', {
    method: 'DELETE',
    body: JSON.stringify({ clientId }),
  })
  if (res.status === 402) return { ok: false, paymentRequired: true }
  return { ok: res.ok }
}

/** Notion connection status from GET /notion/status (match extension api-client). */
export interface NotionStatus {
  connected: boolean
  notionWorkspaceId?: string
  notionWorkspaceName?: string | null
  syncRootPageId?: string | null
  lastSyncAt?: string | null
}

/** GET /notion/oauth/authorize-url (requires JWT). Returns URL to open for Notion OAuth. */
export async function getNotionAuthorizeUrl(db: NoticDB): Promise<{ url: string } | null> {
  const res = await fetchWithAuth(db, '/notion/oauth/authorize-url')
  if (!res.ok) return null
  const data = (await res.json()) as { url?: string }
  return typeof data?.url === 'string' ? { url: data.url } : null
}

/** GET /notion/status (requires JWT). */
export async function getNotionStatus(db: NoticDB): Promise<NotionStatus | null> {
  const res = await fetchWithAuth(db, '/notion/status')
  if (!res.ok) return null
  const data = (await res.json()) as NotionStatus
  return data?.connected === true || data?.connected === false ? data : null
}

/** POST /notion/sync-root (requires JWT). syncRootPageIdOrUrl: Notion page ID or full page URL. */
export async function setNotionSyncRoot(
  db: NoticDB,
  syncRootPageIdOrUrl: string
): Promise<boolean> {
  const res = await fetchWithAuth(db, '/notion/sync-root', {
    method: 'POST',
    body: JSON.stringify({ syncRootPageIdOrUrl: syncRootPageIdOrUrl.trim() }),
  })
  return res.ok
}

/** POST /notion/sync (requires JWT). Returns paymentRequired when backend returns 402 (Pro required). */
export async function syncToNotion(
  db: NoticDB
): Promise<{ ok: boolean; message?: string; paymentRequired?: boolean }> {
  const res = await fetchWithAuth(db, '/notion/sync', { method: 'POST' })
  if (res.status === 402) return { ok: false, paymentRequired: true }
  if (!res.ok) {
    const text = await res.text()
    let message: string | undefined
    try {
      const json = JSON.parse(text) as { message?: string }
      message = json?.message
    } catch {
      message = text || `Sync failed: ${res.status}`
    }
    return { ok: false, message }
  }
  return { ok: true }
}

/** GET /export/obsidian (requires JWT). Returns { files: [{ path, content }] } for Obsidian export. */
export interface ObsidianExportFile {
  path: string
  content: string
}

export type GetObsidianExportResult =
  | { files: ObsidianExportFile[]; paymentRequired?: false }
  | { paymentRequired: true }

/** GET /export/obsidian. paymentRequired: true when backend returns 402 (Pro required). */
export async function getObsidianExport(db: NoticDB): Promise<GetObsidianExportResult | null> {
  const res = await fetchWithAuth(db, '/export/obsidian')
  if (res.status === 402) return { paymentRequired: true }
  if (!res.ok) return null
  const data = (await res.json()) as { files?: ObsidianExportFile[] }
  return Array.isArray(data?.files) ? { files: data.files } : null
}
