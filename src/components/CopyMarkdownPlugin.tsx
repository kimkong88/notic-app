/**
 * CopyMarkdownPlugin — overrides copy/cut so that the clipboard's text/plain
 * contains markdown syntax (# heading, **bold**, | table |, etc.) instead of
 * stripped plain text.
 *
 * Also sets text/html so rich-paste targets (Slack, Google Docs, …) still get
 * formatted content.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getRoot,
    $getSelection,
    $isRangeSelection,
    COPY_COMMAND,
    CUT_COMMAND,
    COMMAND_PRIORITY_CRITICAL,
} from "lexical";
import { $generateHtmlFromNodes } from "@lexical/html";
import { $convertToMarkdownString } from "@lexical/markdown";
import { MARKDOWN_TRANSFORMERS } from "../transformers";

export function CopyMarkdownPlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        const handle = (event: ClipboardEvent, isCut: boolean): boolean => {
            const selection = $getSelection();
            if (!selection || selection.getTextContent() === "") return false;

            // ── Markdown for text/plain ──
            const fullText = $getRoot().getTextContent();
            const selectedText = selection.getTextContent();

            let markdown: string;

            if (selectedText.length >= fullText.length * 0.9) {
                // Full (or near-full) selection → export complete markdown
                markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
            } else {
                // Partial selection → find selected portion in the full markdown
                const fullMd = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
                const idx = fullMd.indexOf(selectedText);

                if (idx !== -1) {
                    // Expand to line boundaries for clean markdown
                    let start = fullMd.lastIndexOf("\n", idx);
                    start = start === -1 ? 0 : start + 1;
                    let end = fullMd.indexOf("\n", idx + selectedText.length);
                    end = end === -1 ? fullMd.length : end;
                    markdown = fullMd.slice(start, end);
                } else {
                    // Fallback: raw selected text
                    markdown = selectedText;
                }
            }

            // ── HTML for text/html (rich paste targets) ──
            const html = $generateHtmlFromNodes(editor, selection);

            // ── Write to clipboard ──
            event.preventDefault();
            event.clipboardData?.setData("text/plain", markdown);
            event.clipboardData?.setData("text/html", html);

            // Cut: remove selected content
            if (isCut && $isRangeSelection(selection)) {
                selection.removeText();
            }

            return true;
        };

        const unregCopy = editor.registerCommand(
            COPY_COMMAND,
            (event) => {
                if (!(event instanceof ClipboardEvent)) return false;
                return handle(event, false);
            },
            COMMAND_PRIORITY_CRITICAL
        );

        const unregCut = editor.registerCommand(
            CUT_COMMAND,
            (event) => {
                if (!(event instanceof ClipboardEvent)) return false;
                return handle(event, true);
            },
            COMMAND_PRIORITY_CRITICAL
        );

        return () => {
            unregCopy();
            unregCut();
        };
    }, [editor]);

    return null;
}
