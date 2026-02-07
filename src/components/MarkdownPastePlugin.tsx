/**
 * MarkdownPastePlugin — intercepts plain-text paste events and converts
 * markdown syntax into proper Lexical nodes (headings, lists, tables, etc.).
 *
 * Uses Lexical's own $convertFromMarkdownString with all registered
 * transformers, so every markdown feature the editor supports is handled.
 *
 * If the clipboard carries text/html (e.g. copy from a website), the paste
 * is left to Lexical's default rich-text handler.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getRoot,
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
    PASTE_COMMAND,
    COMMAND_PRIORITY_HIGH,
    type LexicalNode,
    type ElementNode,
} from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { MARKDOWN_TRANSFORMERS } from "../transformers";

/** Quick test: does the text contain any markdown-like syntax? */
function looksLikeMarkdown(text: string): boolean {
    return /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^>\s|^```|^\|.+\||\*\*.+\*\*|\*.+\*|~~.+~~|`.+`|\[.+\]\(.+\)|^\s*[-*+]\s\[[ x]\]/m.test(
        text
    );
}

export function MarkdownPastePlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        return editor.registerCommand(
            PASTE_COMMAND,
            (event) => {
                const clipboardData =
                    event instanceof ClipboardEvent
                        ? event.clipboardData
                        : null;
                if (!clipboardData) return false;

                // If HTML is present, let Lexical's default handler deal with it
                const html = clipboardData.getData("text/html");
                if (html && html.trim()) return false;

                const text = clipboardData.getData("text/plain");
                if (!text || !text.trim()) return false;

                // Only intercept if the text looks like markdown
                if (!looksLikeMarkdown(text)) return false;

                event.preventDefault();

                editor.update(() => {
                    const selection = $getSelection();
                    if (!$isRangeSelection(selection)) return;

                    // Remember where to insert
                    const anchorNode = selection.anchor.getNode();
                    const block = anchorNode.getTopLevelElement();

                    // ── Parse pasted markdown using Lexical's own parser ──
                    // 1. Detach current children from root
                    const root = $getRoot();
                    const saved: LexicalNode[] = [];
                    for (const child of root.getChildren()) {
                        saved.push(child);
                        child.remove();
                    }

                    // 2. Parse pasted markdown into the now-empty root
                    $convertFromMarkdownString(text, MARKDOWN_TRANSFORMERS);

                    // 3. Collect parsed nodes and detach them
                    const parsed: LexicalNode[] = [];
                    for (const child of root.getChildren()) {
                        parsed.push(child);
                        child.remove();
                    }

                    // 4. Restore original children
                    for (const child of saved) {
                        root.append(child);
                    }

                    // 5. Insert parsed nodes at cursor position
                    if (parsed.length === 0) return;

                    if (block) {
                        let insertAfter: LexicalNode = block;
                        for (const node of parsed) {
                            insertAfter.insertAfter(node);
                            insertAfter = node;
                        }
                        // Select end of last inserted node
                        const last = parsed[parsed.length - 1];
                        if ("selectEnd" in last) {
                            (last as ElementNode).selectEnd();
                        }
                    } else {
                        // Fallback: append to root
                        for (const node of parsed) {
                            root.append(node);
                        }
                        const trailing = $createParagraphNode();
                        root.append(trailing);
                        trailing.selectStart();
                    }
                });

                return true;
            },
            COMMAND_PRIORITY_HIGH
        );
    }, [editor]);

    return null;
}
