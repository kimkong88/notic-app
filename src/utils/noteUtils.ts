/**
 * Note helpers (title from content, preview) – aligned with notic extension.
 */

/** Escape string for safe use in HTML body. */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/** Highlight matching query in text (returns HTML with <mark class="search-highlight">). Escape text first. */
export function highlightMatch(text: string, query: string): string {
  if (!query || !text) return text
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  return text.replace(regex, '<mark class="search-highlight">$1</mark>')
}

const SEARCH_HIGHLIGHT_CLASS = 'search-highlight'

/** Remove all search highlights from an element (unwrap <mark>). */
export function clearSearchHighlightInElement(el: HTMLElement): void {
  el.querySelectorAll(`.${SEARCH_HIGHLIGHT_CLASS}`).forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    const text = document.createTextNode(mark.textContent ?? '')
    parent.replaceChild(text, mark)
    parent.normalize()
  })
}

/** Wrap matching text in element with <mark class="search-highlight"> (for detail view). */
export function applySearchHighlightInElement(el: HTMLElement, query: string): void {
  if (!query || !el) return
  clearSearchHighlightInElement(el)
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(escaped, 'gi')
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null)
  const textNodes: Text[] = []
  let n: Text | null = walker.nextNode() as Text | null
  while (n) {
    textNodes.push(n)
    n = walker.nextNode() as Text | null
  }
  textNodes.forEach((textNode) => {
    const text = textNode.textContent ?? ''
    const match = text.match(regex)
    if (!match) return
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    regex.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)))
      }
      const mark = document.createElement('mark')
      mark.className = SEARCH_HIGHLIGHT_CLASS
      mark.textContent = m[0]
      fragment.appendChild(mark)
      lastIndex = m.index + m[0].length
    }
    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }
    textNode.parentNode?.replaceChild(fragment, textNode)
  })
}

/** Hard limit: max characters per note (50k). Match notic extension. */
export const NOTE_CHAR_LIMIT = 50_000
/** Soft warning: show message when note reaches this many characters (40k). */
export const NOTE_CHAR_WARNING = 40_000

/** Extract title from markdown content: first line or # heading. */
export function extractTitle(content: string, existingTitle?: string): string {
  if (!content || content.trim() === '') {
    return existingTitle || 'Untitled'
  }
  const firstLine = content.split('\n')[0].trim()
  const headingMatch = firstLine.match(/^#{1,6}\s+(.+)$/)
  if (headingMatch) {
    return headingMatch[1].trim()
  }
  if (firstLine) {
    return firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine
  }
  return existingTitle || 'Untitled'
}

/** Strip markdown syntax for display (e.g. title in sidebar, list, detail). Match extension behavior. */
export function stripMarkdownForDisplay(text: string): string {
  if (!text || !text.trim()) return text
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

/** Plain preview for list items (first lines, strip markdown, cap length). */
export function getContentPreview(content: string, maxLength = 150): string {
  if (!content || content.trim() === '') return ''
  const lines = content.split('\n').filter((l) => l.trim() !== '')
  const preview = lines.slice(0, 3).join(' ')
  const stripped = preview
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
  return stripped.length > maxLength ? stripped.slice(0, maxLength) + '…' : stripped
}
