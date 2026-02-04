/**
 * Image upload to Notic backend (POST /upload/image).
 * Auth optional: if token is present (notic_authAccessToken), sends Bearer header; endpoint may allow unauthenticated upload.
 * Set VITE_API_URL in .env for dev (e.g. http://localhost:3002); default is https://api.getnotic.io.
 */

const AUTH_ACCESS_TOKEN_KEY = 'notic_authAccessToken'

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

function getApiUrl(): string {
  const url =
    typeof import.meta !== 'undefined' &&
    (import.meta.env?.VITE_API_URL as string | undefined)
  return url && url.length > 0 ? url.replace(/\/$/, '') : 'https://api.getnotic.io'
}

/** SPA: read access token from localStorage (same key as extension for compatibility). */
export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null
  const read = (w: Window | null): string | null => {
    if (!w?.localStorage) return null
    try {
      const t = w.localStorage.getItem(AUTH_ACCESS_TOKEN_KEY)
      return typeof t === 'string' && t.length > 0 ? t : null
    } catch {
      return null
    }
  }
  // PiP iframe often has partitioned/empty storage; use opener or parent (same-origin) where user signed in.
  const fromOpener = read(window.opener ?? null)
  if (fromOpener) return fromOpener
  if (window.parent !== window) {
    const fromParent = read(window.parent)
    if (fromParent) return fromParent
    const fromParentOpener = read((window.parent as Window & { opener?: Window }).opener ?? null)
    if (fromParentOpener) return fromParentOpener
  }
  return read(window)
}

/**
 * Upload an image file to the backend. Returns the CDN URL.
 * Sends Bearer token when available; endpoint may allow unauthenticated upload.
 * @throws Error on invalid type, or when server returns error (e.g. 401 = sign in)
 */
export async function uploadImage(file: File): Promise<{ url: string }> {
  if (!file.type.startsWith('image/') || !ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(
      `Invalid image type: ${file.type}. Allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}`
    )
  }

  const baseUrl = getApiUrl()
  const formData = new FormData()
  formData.append('file', file)

  const token = getAccessToken()
  const headers: HeadersInit = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  // Do not set Content-Type; browser sets multipart boundary

  const res = await fetch(`${baseUrl}/upload/image`, {
    method: 'POST',
    headers,
    body: formData,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      res.status === 401 ? 'Sign in to upload images' : text || `Upload failed: ${res.status}`
    )
  }

  const data = (await res.json()) as { url?: string }
  if (typeof data?.url !== 'string') throw new Error('Invalid upload response')
  return { url: data.url }
}
