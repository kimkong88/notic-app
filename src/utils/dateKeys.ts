/**
 * Date grouping for Recent tab (same contract as notic dashboard-utils).
 */

/** Format timestamp as YYYY-M-D for folder grouping (e.g. "2026-2-2"). */
export function formatDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = date.getMonth() + 1
  const day = date.getDate()
  return `${year}-${month}-${day}`
}

/** Parse date key back to timestamp for sorting. */
export function parseDateKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).getTime()
}

/**
 * Format timestamp for display: "Just now", "5m ago", "Yesterday", "Jan 27".
 * Matches notic extension dashboard-utils formatDate.
 */
export function formatDate(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`

  const date = new Date(timestamp)
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  const day = date.getDate()
  return `${month} ${day}`
}
