/**
 * Image node for Lexical (match notic extension).
 * Renders as thumbnail; markdown import/export via IMAGE transformer.
 * In React, decorate() must return a React element, not HTMLElement.
 */

import type { ReactElement } from 'react'
import { createElement } from 'react'
import type { LexicalEditor } from 'lexical'
import type { EditorConfig } from 'lexical'
import type { RangeSelection } from 'lexical'
import { $createParagraphNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import type { TextMatchTransformer } from '@lexical/markdown'

export type SerializedImageNode = { type: 'image'; version: 1; src: string; alt?: string }

function escapeImageUrlForMarkdown(url: string): string {
  return url.replace(/_/g, '\\_')
}

function unescapeImageUrlFromMarkdown(url: string): string {
  return url.replace(/\\_/g, '_')
}

export class ImageNode extends DecoratorNode<ReactElement> {
  __src: string
  __alt: string

  static getType(): 'image' {
    return 'image'
  }

  static clone(node: ImageNode): ImageNode {
    return new ImageNode(node.__src, node.__alt, node.getKey())
  }

  constructor(src: string, alt: string = 'image', key?: string) {
    super(key)
    this.__src = src
    this.__alt = alt
  }

  getSrc(): string {
    return this.__src
  }

  getAltText(): string {
    return this.__alt
  }

  setSrc(src: string): this {
    const self = this.getWritable()
    self.__src = src
    return self
  }

  setAltText(alt: string): this {
    const self = this.getWritable()
    self.__alt = alt
    return self
  }

  isInline(): boolean {
    return true
  }

  getTextContent(): string {
    return `![${this.__alt}](${escapeImageUrlForMarkdown(this.__src)})`
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const img = document.createElement('img')
    img.src = this.__src
    img.alt = this.__alt
    img.loading = 'lazy'
    img.style.maxWidth = '100%'
    img.style.height = 'auto'
    img.style.verticalAlign = 'middle'
    img.style.borderRadius = '4px'
    img.className = 'note-editor-image'
    return img
  }

  updateDOM(prevNode: ImageNode, dom: HTMLElement): boolean {
    if (prevNode.__src !== this.__src || prevNode.__alt !== this.__alt) {
      ;(dom as HTMLImageElement).src = this.__src
      ;(dom as HTMLImageElement).alt = this.__alt
    }
    return false
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): ReactElement {
    return createElement('img', {
      src: this.__src,
      alt: this.__alt,
      loading: 'lazy',
      className: 'note-editor-image',
      style: {
        maxWidth: '100%',
        height: 'auto',
        verticalAlign: 'middle',
        borderRadius: '4px',
      },
    })
  }

  exportJSON(): SerializedImageNode {
    return { type: 'image', version: 1, src: this.__src, alt: this.__alt }
  }

  static importJSON(serialized: SerializedImageNode): ImageNode {
    return new ImageNode(serialized.src, serialized.alt ?? 'image')
  }

  insertNewAfter(_selection: RangeSelection): import('lexical').ParagraphNode | null {
    const paragraph = $createParagraphNode()
    this.insertAfter(paragraph)
    return paragraph
  }
}

export function $createImageNode(src: string, alt: string = 'image'): ImageNode {
  return new ImageNode(src, alt)
}

export function $isImageNode(node: unknown): node is ImageNode {
  return node instanceof ImageNode
}

/** Markdown image ![alt](url) – import/export (match notic). */
export const IMAGE: TextMatchTransformer = {
  type: 'text-match',
  dependencies: [ImageNode],
  export: (node) =>
    $isImageNode(node)
      ? `![${node.getAltText()}](${escapeImageUrlForMarkdown(node.getSrc())})`
      : null,
  importRegExp: /!\[([^\]]*)\]\(([^)]+)\)/,
  regExp: /!\[([^\]]*)\]\(([^)]+)\)$/,
  replace: (textNode, match) => {
    const alt = (match[1] ?? '').trim() || 'image'
    const src = unescapeImageUrlFromMarkdown((match[2] ?? '').trim())
    if (!src) return
    const imageNode = $createImageNode(src, alt)
    textNode.replace(imageNode)
  },
  trigger: ')',
}
