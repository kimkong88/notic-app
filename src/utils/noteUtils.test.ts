import { describe, it, expect } from 'vitest'
import { highlightMatch, getContentPreview, extractTitle } from './noteUtils'

describe('highlightMatch', () => {
  it('wraps case-insensitive matches in <mark class="search-highlight">', () => {
    const text = 'Hello World'
    expect(highlightMatch(text, 'world')).toContain('<mark class="search-highlight">World</mark>')
    expect(highlightMatch(text, 'hello')).toContain('<mark class="search-highlight">Hello</mark>')
  })

  it('returns text unchanged when query is empty', () => {
    expect(highlightMatch('foo', '')).toBe('foo')
  })

  it('returns text unchanged when text is empty', () => {
    expect(highlightMatch('', 'foo')).toBe('')
  })

  it('escapes regex-special characters in query', () => {
    const text = 'a (b) c'
    expect(highlightMatch(text, '(b)')).toContain('<mark class="search-highlight">(b)</mark>')
  })

  it('highlights all occurrences', () => {
    const result = highlightMatch('foo bar foo', 'foo')
    expect(result).toContain('<mark class="search-highlight">foo</mark>')
    const count = (result.match(/<mark class="search-highlight">foo<\/mark>/g) ?? []).length
    expect(count).toBe(2)
  })
})

describe('getContentPreview', () => {
  it('returns empty string for empty content', () => {
    expect(getContentPreview('')).toBe('')
    expect(getContentPreview('   \n  ')).toBe('')
  })

  it('strips markdown headers and bold/italic', () => {
    expect(getContentPreview('# Title\nBody')).not.toContain('#')
    expect(getContentPreview('**bold** and *italic*')).toBe('bold and italic')
  })

  it('caps length with ellipsis', () => {
    const long = 'a'.repeat(200)
    const result = getContentPreview(long, 50)
    expect(result.length).toBeLessThanOrEqual(51)
    expect(result.endsWith('…')).toBe(true)
  })
})

describe('extractTitle (from content for note title)', () => {
  it('returns existingTitle or Untitled for empty content', () => {
    expect(extractTitle('', 'Fallback')).toBe('Fallback')
    expect(extractTitle('', undefined)).toBe('Untitled')
  })

  it('uses # heading as title', () => {
    expect(extractTitle('# My Title\nbody')).toBe('My Title')
    expect(extractTitle('## H2 Title')).toBe('H2 Title')
  })

  it('uses first line as title when no heading', () => {
    expect(extractTitle('First line\nSecond')).toBe('First line')
  })

  it('caps first line at 50 chars with ...', () => {
    const long = 'a'.repeat(60)
    expect(extractTitle(long)).toBe('a'.repeat(50) + '...')
  })
})
