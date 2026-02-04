import { describe, it, expect, vi, afterEach } from 'vitest'
import { isDocumentPipSupported } from './documentPip'

describe('isDocumentPipSupported', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns false when documentPictureInPicture is absent', () => {
    vi.stubGlobal('window', {})
    expect(isDocumentPipSupported()).toBe(false)
  })

  it('returns false when documentPictureInPicture has no requestWindow', () => {
    vi.stubGlobal('window', { documentPictureInPicture: {} })
    expect(isDocumentPipSupported()).toBe(false)
  })

  it('returns true when documentPictureInPicture.requestWindow is a function', () => {
    vi.stubGlobal('navigator', { userAgent: 'Chrome/120.0' })
    vi.stubGlobal('window', {
      documentPictureInPicture: { requestWindow: async () => ({} as Window) },
    })
    expect(isDocumentPipSupported()).toBe(true)
  })

  it('returns false in Cursor-like environment even when API exists', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 CursorBrowser/1.0' })
    vi.stubGlobal('window', {
      documentPictureInPicture: { requestWindow: async () => ({} as Window) },
    })
    expect(isDocumentPipSupported()).toBe(false)
  })
})
