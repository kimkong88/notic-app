import { describe, it, expect } from 'vitest'
import { formatDateKey, parseDateKey, formatDate } from './dateKeys'

describe('dateKeys', () => {
  describe('formatDateKey', () => {
    it('formats timestamp as YYYY-M-D', () => {
      const ts = new Date(2026, 1, 2).getTime() // Feb 2, 2026
      expect(formatDateKey(ts)).toBe('2026-2-2')
    })

    it('uses 1-based month (no leading zero)', () => {
      const ts = new Date(2025, 0, 1).getTime() // Jan 1
      expect(formatDateKey(ts)).toBe('2025-1-1')
    })

    it('single-digit month and day not zero-padded', () => {
      const ts = new Date(2024, 10, 5).getTime() // Nov 5
      expect(formatDateKey(ts)).toBe('2024-11-5')
    })
  })

  describe('parseDateKey', () => {
    it('parses YYYY-M-D back to start-of-day timestamp', () => {
      const key = '2026-2-2'
      const ts = parseDateKey(key)
      const d = new Date(ts)
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(1)
      expect(d.getDate()).toBe(2)
    })

    it('round-trips with formatDateKey', () => {
      const original = new Date(2025, 6, 15).getTime()
      const key = formatDateKey(original)
      const parsed = parseDateKey(key)
      const d = new Date(parsed)
      expect(d.getFullYear()).toBe(2025)
      expect(d.getMonth()).toBe(6)
      expect(d.getDate()).toBe(15)
    })
  })

  describe('formatDate (display)', () => {
    it('returns "Just now" for very recent timestamp', () => {
      const now = Date.now()
      expect(formatDate(now)).toBe('Just now')
    })

    it('returns "Xm ago" for minutes', () => {
      const ts = Date.now() - 5 * 60 * 1000
      expect(formatDate(ts)).toMatch(/^\d+m ago$/)
    })

    it('returns "Xd ago" for days under 7', () => {
      const ts = Date.now() - 2 * 24 * 60 * 60 * 1000
      expect(formatDate(ts)).toMatch(/^\d+d ago$/)
    })
  })
})
