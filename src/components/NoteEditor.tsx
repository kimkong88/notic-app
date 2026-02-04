import { useCallback, useEffect, useMemo, useRef } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { MarkdownShortcutPlugin } from '@lexical/react/LexicalMarkdownShortcutPlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin'
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { ClickableLinkPlugin } from '@lexical/react/LexicalClickableLinkPlugin'
import {
  $getRoot,
  $createParagraphNode,
  type EditorState,
  type LexicalEditor,
} from 'lexical'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { CodeNode, CodeHighlightNode } from '@lexical/code'
import { LinkNode } from '@lexical/link'
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode'
import { ImageNode, IMAGE } from '../nodes/ImageNode'
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown'
import {
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  MULTILINE_ELEMENT_TRANSFORMERS,
  TEXT_FORMAT_TRANSFORMERS,
  TEXT_MATCH_TRANSFORMERS,
} from '@lexical/markdown'
import { SlashCommandPlugin } from './SlashCommandPlugin'
import { ImageDropPastePlugin } from './ImageDropPastePlugin'
import { EditorToolbarPlugin } from './EditorToolbarPlugin'

/** Markdown transformers: CHECK_LIST before UNORDERED_LIST; IMAGE before other text-match (match notic). */
const MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING,
  QUOTE,
  CHECK_LIST,
  UNORDERED_LIST,
  ORDERED_LIST,
  ...MULTILINE_ELEMENT_TRANSFORMERS,
  ...TEXT_FORMAT_TRANSFORMERS,
  IMAGE,
  ...TEXT_MATCH_TRANSFORMERS,
]

const editorTheme = {
  paragraph: 'note-editor-paragraph',
  heading: {
    h1: 'note-editor-heading-h1',
    h2: 'note-editor-heading-h2',
    h3: 'note-editor-heading-h3',
  },
  list: {
    nested: { listitem: 'note-editor-nested-listitem' },
    ol: 'note-editor-list-ol',
    ul: 'note-editor-list-ul',
    listitem: 'note-editor-listitem',
    listitemChecked: 'note-editor-listitem-checked',
    listitemUnchecked: 'note-editor-listitem-unchecked',
  },
  quote: 'note-editor-quote',
  code: 'note-editor-code',
  link: 'note-editor-link',
  image: 'note-editor-image',
  text: {
    bold: 'note-editor-text-bold',
    italic: 'note-editor-text-italic',
  },
}

export interface NoteEditorProps {
  /** Initial body content (markdown). */
  initialContent: string
  /** Callback when content changes (debounced by caller if needed). Receives markdown. */
  onChange: (content: string) => void
  /** Called on unmount/beforeunload to persist immediately (no debounce). Match notic flush. */
  onFlush?: (content: string) => void
  /** Optional: report content length for char-limit warning (e.g. PiP). */
  onContentLengthChange?: (length: number) => void
  /** Placeholder when body is empty. */
  placeholder?: string
  /** Optional class name for the content wrapper. */
  className?: string
  /** If set, remount editor when this changes (e.g. noteId) so initialContent is re-applied. */
  editorKey?: string
  /** When true, show a format toolbar (bold, italic, code) above the editor. Used in note detail view. */
  showToolbar?: boolean
  /** When true, render content as read-only (same Lexical + markdown rendering, no editing). Used for detail view. */
  readOnly?: boolean
  /** Optional ref to register imperative flush (e.g. so PiP can flush on main-app selection change). */
  registerFlushRef?: React.MutableRefObject<(() => void) | null>
}

function setInitialContentFromMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    if (!markdown.trim()) {
      root.append($createParagraphNode())
      return
    }
    $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS)
  })
}

function getMarkdownFromEditor(editor: LexicalEditor): string {
  let markdown = ''
  editor.getEditorState().read(() => {
    markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
  })
  return markdown
}

/** Set editor to read-only (used for detail view viewer, same behaviour as notic initializeReadOnlyViewer). */
function ReadOnlyPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.setEditable(false)
  }, [editor])
  return null
}

/** Flush current content on unmount and beforeunload so we don't lose data (match notic PiP). */
function FlushOnUnmountPlugin({ onFlush }: { onFlush?: (content: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const onFlushRef = useRef(onFlush)
  useEffect(() => {
    onFlushRef.current = onFlush
  }, [onFlush])
  useEffect(() => {
    const flush = () => {
      const cb = onFlushRef.current
      if (!cb) return
      const markdown = getMarkdownFromEditor(editor)
      cb(markdown)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [editor])
  return null
}

/** Flush on blur so content is persisted when user navigates away before debounce fires (match notic editor). */
function FlushOnBlurPlugin({ onFlush }: { onFlush?: (content: string) => void }) {
  const [editor] = useLexicalComposerContext()
  const onFlushRef = useRef(onFlush)
  useEffect(() => {
    onFlushRef.current = onFlush
  }, [onFlush])
  useEffect(() => {
    let blurCleanup: (() => void) | null = null
    const unregister = editor.registerRootListener((rootElement, prevRootElement) => {
      if (prevRootElement) {
        blurCleanup?.()
        blurCleanup = null
      }
      if (!rootElement) return
      const handleBlur = () => {
        const cb = onFlushRef.current
        if (!cb) return
        const markdown = getMarkdownFromEditor(editor)
        cb(markdown)
      }
      rootElement.addEventListener('blur', handleBlur, true)
      blurCleanup = () => {
        rootElement.removeEventListener('blur', handleBlur, true)
        blurCleanup = null
      }
    })
    return () => {
      blurCleanup?.()
      unregister()
    }
  }, [editor])
  return null
}

/** Expose flush so parent can request immediate save (e.g. PiP on main-app selection change). */
function RegisterFlushRefPlugin({
  onFlush,
  registerFlushRef,
}: {
  onFlush?: (content: string) => void
  registerFlushRef?: React.MutableRefObject<(() => void) | null>
}) {
  const [editor] = useLexicalComposerContext()
  const onFlushRef = useRef(onFlush)
  useEffect(() => {
    onFlushRef.current = onFlush
  }, [onFlush])
  useEffect(() => {
    const ref = registerFlushRef
    if (!ref) return
    ref.current = () => {
      const cb = onFlushRef.current
      if (!cb) return
      const markdown = getMarkdownFromEditor(editor)
      cb(markdown)
    }
    return () => {
      ref.current = null
    }
  }, [editor, registerFlushRef])
  return null
}

const initialConfigNodes = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  CodeHighlightNode,
  LinkNode,
  HorizontalRuleNode,
  ImageNode,
]

export function NoteEditor({
  initialContent,
  onChange,
  onFlush,
  onContentLengthChange,
  placeholder = 'Start writing...',
  className = '',
  editorKey = 'default',
  showToolbar = false,
  readOnly = false,
  registerFlushRef,
}: NoteEditorProps) {
  const initialConfig = useMemo(
    () => ({
      namespace: readOnly ? 'NoteViewer' : 'NoteEditor',
      theme: editorTheme,
      nodes: initialConfigNodes,
      onError: (err: Error) => console.error('Lexical', err),
      editorState: (editor: LexicalEditor) =>
        setInitialContentFromMarkdown(editor, initialContent),
    }),
    [editorKey, initialContent, readOnly]
  )

  const handleChange = useCallback(
    (_editorState: EditorState, editor: LexicalEditor) => {
      const markdown = getMarkdownFromEditor(editor)
      onChange(markdown)
      onContentLengthChange?.(markdown.length)
    },
    [onChange, onContentLengthChange]
  )

  return (
    <div className={`note-editor ${className}`.trim()} data-editor-key={editorKey} data-read-only={readOnly || undefined}>
      <LexicalComposer initialConfig={initialConfig}>
        {readOnly && <ReadOnlyPlugin />}
        {showToolbar && !readOnly && <EditorToolbarPlugin />}
        <div className="note-editor-body">
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                className="note-editor-content-editable"
                aria-placeholder={placeholder}
                placeholder={
                  <span className="note-editor-placeholder">{placeholder}</span>
                }
              />
            }
            placeholder={
              <span className="note-editor-placeholder">{placeholder}</span>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        {!readOnly && (
          <>
            <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
            <HistoryPlugin />
            <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
            <SlashCommandPlugin />
            <ImageDropPastePlugin />
            <FlushOnUnmountPlugin onFlush={onFlush} />
            <FlushOnBlurPlugin onFlush={onFlush} />
            <RegisterFlushRefPlugin onFlush={onFlush} registerFlushRef={registerFlushRef} />
          </>
        )}
        <ListPlugin />
        <CheckListPlugin />
        <HorizontalRulePlugin />
        <LinkPlugin />
        <ClickableLinkPlugin />
      </LexicalComposer>
    </div>
  )
}
