/**
 * Note detail format toolbar – matches notic extension exactly (dashboard-notes.ts noteDetailEditorToolbar + editor.applyEditorFormat).
 * Class names: note-detail-editor-toolbar, note-detail-toolbar-btn, note-detail-toolbar-image-wrap.
 */

import { useCallback, useRef, useState, useEffect } from 'react'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import {
  $getRoot,
  $getSelection,
  $getNodeByKey,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  FORMAT_TEXT_COMMAND,
} from 'lexical'
import { $createHeadingNode, $createQuoteNode } from '@lexical/rich-text'
import { $createHorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { $insertList } from '@lexical/list'
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  Image as ImageIcon,
} from 'lucide-react'
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

export function EditorToolbarPlugin() {
  const [editor] = useLexicalComposerContext()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imageDropdownShow, setImageDropdownShow] = useState(false)

  const applyFormat = useCallback(
    (format: string) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        switch (format) {
          case 'bold':
          case 'italic':
          case 'code':
            if (!selection.isCollapsed()) {
              editor.dispatchCommand(FORMAT_TEXT_COMMAND, format as 'bold' | 'italic' | 'code')
            }
            break
          case 'heading1':
          case 'heading2':
          case 'heading3': {
            if (!selection.isCollapsed()) break
            const anchorNode = selection.anchor.getNode()
            const block = anchorNode.getTopLevelElement()
            if (!block) break
            const level = parseInt(format.replace('heading', ''), 10) as 1 | 2 | 3
            const text = block.getTextContent()
            const heading = $createHeadingNode(`h${level}` as 'h1' | 'h2' | 'h3')
            if (text.length > 0) heading.append($createTextNode(text))
            block.replace(heading)
            heading.selectEnd()
            break
          }
          case 'bulletList':
          case 'numberList':
          case 'taskList':
            $insertList(
              format === 'bulletList' ? 'bullet' : format === 'numberList' ? 'number' : 'check'
            )
            break
          case 'quote': {
            if (!selection.isCollapsed()) break
            const anchorNode = selection.anchor.getNode()
            const block = anchorNode.getTopLevelElement()
            if (!block) break
            const text = block.getTextContent()
            const quote = $createQuoteNode()
            const para = $createParagraphNode()
            if (text.length > 0) para.append($createTextNode(text))
            quote.append(para)
            block.replace(quote)
            para.selectEnd()
            break
          }
          case 'divider': {
            const anchorNode = selection.anchor.getNode()
            const block = anchorNode.getTopLevelElement()
            if (!block) break
            const hr = $createHorizontalRuleNode()
            const para = $createParagraphNode()
            block.insertAfter(hr)
            hr.insertAfter(para)
            para.selectStart()
            break
          }
          default:
            break
        }
      })
      editor.focus()
    },
    [editor]
  )

  const onToolbarButtonMouseDown = useCallback(
    (e: React.MouseEvent, format: string) => {
      e.preventDefault()
      applyFormat(format)
    },
    [applyFormat]
  )

  const handleImageUpload = useCallback(() => {
    setImageDropdownShow(false)
    fileInputRef.current?.click()
  }, [])

  const handleImageFromUrl = useCallback(() => {
    setImageDropdownShow(false)
    const url = window.prompt('Enter image URL:')
    if (url?.trim()) {
      editor.focus()
      insertImageAtPosition(editor, url.trim(), null)
    }
  }, [editor])

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !file.type.startsWith('image/')) return
      uploadImage(file)
        .then(({ url }) => {
          editor.focus()
          insertImageAtPosition(editor, url, null)
        })
        .catch((err) => console.error('Image upload failed:', err instanceof Error ? err.message : err))
    },
    [editor]
  )

  const toggleImageDropdown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setImageDropdownShow((s) => !s)
  }, [])

  const toolbarRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!imageDropdownShow) return
    const onOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setImageDropdownShow(false)
      }
    }
    const t = setTimeout(() => document.addEventListener('click', onOutside, true), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onOutside, true)
    }
  }, [imageDropdownShow])

  return (
    <div
      ref={toolbarRef}
      className="note-detail-editor-toolbar"
      id="noteDetailEditorToolbar"
      role="toolbar"
      aria-label="Formatting"
    >
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="bold"
        title="Bold"
        aria-label="Bold"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'bold')}
      >
        <Bold size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="italic"
        title="Italic"
        aria-label="Italic"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'italic')}
      >
        <Italic size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="code"
        title="Code"
        aria-label="Code"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'code')}
      >
        <Code size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="heading1"
        title="Heading 1"
        aria-label="Heading 1"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'heading1')}
      >
        <Heading1 size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="heading2"
        title="Heading 2"
        aria-label="Heading 2"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'heading2')}
      >
        <Heading2 size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="heading3"
        title="Heading 3"
        aria-label="Heading 3"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'heading3')}
      >
        <Heading3 size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="bulletList"
        title="Bullet list"
        aria-label="Bullet list"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'bulletList')}
      >
        <List size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="numberList"
        title="Numbered list"
        aria-label="Numbered list"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'numberList')}
      >
        <ListOrdered size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="taskList"
        title="Task list"
        aria-label="Task list"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'taskList')}
      >
        <ListTodo size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="quote"
        title="Quote"
        aria-label="Quote"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'quote')}
      >
        <Quote size={16} />
      </button>
      <button
        type="button"
        className="note-detail-toolbar-btn"
        data-format="divider"
        title="Divider"
        aria-label="Divider"
        onMouseDown={(e) => onToolbarButtonMouseDown(e, 'divider')}
      >
        <Minus size={16} />
      </button>
      <div className="note-detail-toolbar-image-wrap">
        <button
          type="button"
          className="note-detail-toolbar-btn"
          data-action="image"
          title="Image"
          aria-label="Image"
          aria-haspopup="true"
          aria-expanded={imageDropdownShow}
          onMouseDown={toggleImageDropdown}
        >
          <ImageIcon size={16} />
        </button>
        <div
          className={`context-menu note-detail-image-dropdown${imageDropdownShow ? ' show' : ''}`}
          id="noteDetailImageDropdown"
          role="menu"
        >
          <button
            type="button"
            className="context-menu-item"
            data-image-action="upload"
            role="menuitem"
            onClick={handleImageUpload}
          >
            <span className="context-menu-item-label">Upload from computer</span>
          </button>
          <button
            type="button"
            className="context-menu-item"
            data-image-action="url"
            role="menuitem"
            onClick={handleImageFromUrl}
          >
            <span className="context-menu-item-label">Insert from URL</span>
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        id="noteDetailImageFileInput"
        hidden
        onChange={onFileChange}
      />
    </div>
  )
}
