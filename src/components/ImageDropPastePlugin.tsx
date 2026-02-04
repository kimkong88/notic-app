/**
 * Handles image drag-and-drop and paste: upload file then insert ImageNode at drop/paste position.
 * Matches notic extension behaviour (editor.ts: image drag/drop + PASTE_COMMAND).
 */

import { useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $isRangeSelection,
  $createParagraphNode,
  PASTE_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
} from 'lexical'
import { uploadImage } from '../api/upload'
import { $createImageNode } from '../nodes/ImageNode'

type InsertAt =
  | { atRoot: true }
  | { atRoot: false; blockKey: string; index: number }
  | null

function insertImageAtPosition(
  editor: import('lexical').LexicalEditor,
  url: string,
  insertAt: InsertAt
): void {
  editor.update(() => {
    const root = $getRoot()
    const imageNode = $createImageNode(url, 'image')
    const paragraph = $createParagraphNode()
    paragraph.append(imageNode)
    if (insertAt) {
      if (insertAt.atRoot) {
        root.append(paragraph)
      } else {
        const block = $getNodeByKey(insertAt.blockKey)
        if (block) block.insertAfter(paragraph)
        else root.splice(insertAt.index, 0, [paragraph])
      }
    } else {
      const selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        root.append(paragraph)
      } else {
        const anchorNode = selection.anchor.getNode()
        const block = anchorNode.getTopLevelElement()
        if (!block || block.getKey() === root.getKey()) {
          root.append(paragraph)
        } else {
          block.insertAfter(paragraph)
        }
      }
    }
    paragraph.selectEnd()
  })
}

function getImageFileFromFiles(files: FileList | null): File | null {
  if (!files?.length) return null
  return Array.from(files).find((f) => f.type.startsWith('image/')) ?? null
}

function getImageFileFromClipboard(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null
  if (clipboardData.files?.length) {
    const f = Array.from(clipboardData.files).find((x) => x.type.startsWith('image/'))
    if (f) return f
  }
  if (clipboardData.items) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i]
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        return item.getAsFile()
      }
    }
  }
  return null
}

export function ImageDropPastePlugin() {
  const [editor] = useLexicalComposerContext()

  // Document-level dragover/drop in capture phase so we run first and prevent "open image in new tab".
  // When editor is inside an iframe (e.g. PiP), the drop event fires in the PARENT document, so we
  // must attach to both the editor's document and the parent document.
  useEffect(() => {
    const editorRoot = editor.getRootElement()

    const handleDrop = (e: DragEvent, doc: Document) => {
      const imageFile = getImageFileFromFiles(e.dataTransfer?.files ?? null)
      if (!imageFile) return

      const target = e.target as Node
      const root = editor.getRootElement()
      const isOverEditor = root?.contains(target)
      const isOverParentPiP =
        typeof window !== 'undefined' &&
        window.parent !== window &&
        doc === window.parent.document &&
        (target === window.frameElement ||
          (target as HTMLElement).id === 'notic-pip-iframe' ||
          (target as HTMLElement).tagName === 'BODY')
      const isInOurDocument = doc === root?.ownerDocument

      if (!isOverEditor && !isOverParentPiP && !isInOurDocument) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      const insertAt: InsertAt = editor.getEditorState().read(() => {
        const sel = $getSelection()
        if (!$isRangeSelection(sel)) return null
        const anchor = sel.anchor.getNode()
        const block = anchor.getTopLevelElement()
        const rootNode = $getRoot()
        if (!block || block.getKey() === rootNode.getKey()) return { atRoot: true } as const
        return {
          atRoot: false,
          blockKey: block.getKey(),
          index: block.getIndexWithinParent() + 1,
        }
      })

      uploadImage(imageFile)
        .then(({ url }) => insertImageAtPosition(editor, url, insertAt))
        .catch((err) => console.error('Image upload failed:', err?.message ?? err))
    }

    const handleDragover = (e: DragEvent, doc: Document) => {
      if (!e.dataTransfer?.types?.includes('Files')) return

      const target = e.target as Node
      const root = editor.getRootElement()
      const isOverEditor = root?.contains(target)
      const isOverParentPiP =
        typeof window !== 'undefined' &&
        window.parent !== window &&
        doc === window.parent.document &&
        (target === window.frameElement ||
          (target as HTMLElement).id === 'notic-pip-iframe' ||
          (target as HTMLElement).tagName === 'BODY')
      const isInOurDocument = doc === root?.ownerDocument

      if (!isOverEditor && !isOverParentPiP && !isInOurDocument) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDragover = (e: DragEvent) => handleDragover(e, e.currentTarget as Document)
    const onDrop = (e: DragEvent) => handleDrop(e, e.currentTarget as Document)

    const doc = editorRoot?.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
    const parentDoc =
      typeof window !== 'undefined' && window.parent !== window ? window.parent.document : null

    if (doc) {
      doc.addEventListener('dragover', onDragover, true)
      doc.addEventListener('drop', onDrop, true)
    }
    if (parentDoc && parentDoc !== doc) {
      parentDoc.addEventListener('dragover', onDragover, true)
      parentDoc.addEventListener('drop', onDrop, true)
    }
    return () => {
      if (doc) {
        doc.removeEventListener('dragover', onDragover, true)
        doc.removeEventListener('drop', onDrop, true)
      }
      if (parentDoc && parentDoc !== doc) {
        parentDoc.removeEventListener('dragover', onDragover, true)
        parentDoc.removeEventListener('drop', onDrop, true)
      }
    }
  }, [editor])

  // PiP iframe: script in PiP document catches drop, posts file data here; we upload and insert.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return
      const d = e.data
      if (d?.type !== 'insertImageFromDrop') return
      if (typeof d.url === 'string') {
        insertImageAtPosition(editor, d.url, null)
        return
      }
      if (d.data instanceof ArrayBuffer && d.mimeType && d.fileName) {
        const file = new File([d.data], d.fileName, { type: d.mimeType })
        uploadImage(file)
          .then(({ url }) => insertImageAtPosition(editor, url, null))
          .catch((err) => console.error('Image upload failed:', err?.message ?? err))
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [editor])

  // Paste: image from clipboard → upload and insert.
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent | InputEvent | KeyboardEvent) => {
        const clipboardData = event && 'clipboardData' in event ? event.clipboardData : null
        const imageFile = getImageFileFromClipboard(clipboardData ?? null)
        if (!imageFile) return false
        event.preventDefault()
        uploadImage(imageFile)
          .then(({ url }) => insertImageAtPosition(editor, url, null))
          .catch((err) => console.error('Image upload failed:', err?.message ?? err))
        return true
      },
      COMMAND_PRIORITY_CRITICAL
    )
  }, [editor])

  return null
}
