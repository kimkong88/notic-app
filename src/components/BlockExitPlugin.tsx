/**
 * BlockExitPlugin — comprehensive block-exit handling for the editor.
 *
 * Solves the "cursor trap" problem for all non-paragraph blocks:
 *   • Quotes, tables, code blocks, horizontal rules, etc.
 *
 * Strategies:
 *   1. **Escape key**: Press Escape inside any block → adds a paragraph
 *      after the block and moves cursor there. Universal "I want out."
 *
 *   2. **Enter on empty quote**: When the cursor is in a QuoteNode and the
 *      current line has no text, the quote is exited:
 *        - If the entire quote is empty → replaced with paragraph.
 *        - If the cursor is on a trailing empty line → that line is removed
 *          and a paragraph is added after the quote.
 *
 *   3. **Trailing paragraph guarantee**: After every update, if the last
 *      child of the root is NOT a ParagraphNode, an empty paragraph is
 *      appended so the user can always click below any block to continue.
 *
 *   4. **Down arrow at end**: Pressing Down at the last position in the
 *      document ensures a paragraph exists after the current block.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getRoot,
    $getSelection,
    $isRangeSelection,
    $createParagraphNode,
    $isParagraphNode,
    $isTextNode,
    $isLineBreakNode,
    $isElementNode,
    KEY_ENTER_COMMAND,
    KEY_ESCAPE_COMMAND,
    KEY_ARROW_DOWN_COMMAND,
    COMMAND_PRIORITY_HIGH,
    COMMAND_PRIORITY_LOW,
    type LexicalNode,
    type ElementNode,
} from "lexical";
import { $isQuoteNode } from "@lexical/rich-text";
import { $isCodeNode } from "@lexical/code";

/* ── helpers ─────────────────────────────────────────────────────────── */

/** Walk up the tree from `node` and return the nearest non-paragraph,
 *  non-root ancestor that is a direct child of root (i.e. a top-level block). */
function $findBlockAncestor(node: LexicalNode): ElementNode | null {
    let current: LexicalNode | null = node;
    while (current) {
        const parent: LexicalNode | null = current.getParent();
        if (parent && $isRootNode(parent) && !$isParagraphNode(current)) {
            return $isElementNode(current) ? current : null;
        }
        current = parent;
    }
    return null;
}

function $isRootNode(
    node: LexicalNode | null
): node is ReturnType<typeof $getRoot> {
    return node !== null && node.getType() === "root";
}

/** Ensure a paragraph exists after `block`, create one if needed, then select it. */
function $exitAfterBlock(
    block: LexicalNode,
    event?: KeyboardEvent | null
): boolean {
    event?.preventDefault();
    const next = block.getNextSibling();
    if (next && $isParagraphNode(next)) {
        next.selectStart();
        return true;
    }
    const para = $createParagraphNode();
    block.insertAfter(para);
    para.selectStart();
    return true;
}

/** Check whether the cursor is on an empty trailing line inside a QuoteNode.
 *  Quotes use inline children (TextNode, LineBreakNode) so an "empty last
 *  line" is: the last child is an empty TextNode preceded by a LineBreakNode,
 *  OR the QuoteNode has no children at all. */
function $isOnEmptyTrailingLineInQuote(quote: ElementNode): boolean {
    const textContent = quote.getTextContent();
    if (textContent.trim() === "") return true; // entirely empty

    // Check if content ends with an empty line (trailing \n)
    if (textContent.endsWith("\n")) return true;

    // Check last child: empty TextNode after a LineBreakNode
    const last = quote.getLastChild();
    if (!last) return true;
    if ($isTextNode(last) && last.getTextContent() === "") {
        const prev = last.getPreviousSibling();
        if (prev && $isLineBreakNode(prev)) return true;
    }

    return false;
}

/* ── plugin ──────────────────────────────────────────────────────────── */

export function BlockExitPlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        // ── 1. ESCAPE KEY: universal block exit ─────────────────────
        const unregEsc = editor.registerCommand(
            KEY_ESCAPE_COMMAND,
            (event) => {
                const selection = $getSelection();
                if (!$isRangeSelection(selection) || !selection.isCollapsed())
                    return false;

                const block = $findBlockAncestor(selection.anchor.getNode());
                if (!block) return false;

                return $exitAfterBlock(block, event);
            },
            COMMAND_PRIORITY_HIGH
        );

        // ── 2. ENTER: exit empty quotes / code blocks ──────────────
        const unregEnter = editor.registerCommand(
            KEY_ENTER_COMMAND,
            (event) => {
                const selection = $getSelection();
                if (!$isRangeSelection(selection) || !selection.isCollapsed())
                    return false;

                const anchorNode = selection.anchor.getNode();

                // Walk up to find a block-level ancestor we care about
                let current: LexicalNode | null = anchorNode;
                let block: ElementNode | null = null;

                while (current) {
                    if ($isQuoteNode(current) || $isCodeNode(current)) {
                        block = current;
                        break;
                    }
                    current = current.getParent();
                }

                if (!block) return false;

                // Entire block is empty → replace with paragraph
                if (block.getTextContent().trim() === "") {
                    event?.preventDefault();
                    const para = $createParagraphNode();
                    block.replace(para);
                    para.selectStart();
                    return true;
                }

                // Cursor is on a trailing empty line → exit
                if (
                    $isQuoteNode(block) &&
                    $isOnEmptyTrailingLineInQuote(block)
                ) {
                    // Verify cursor is actually at the end of the quote
                    const lastDesc = block.getLastDescendant();
                    const anchorKey = selection.anchor.key;
                    const isAtEnd =
                        lastDesc !== null &&
                        (anchorKey === lastDesc.getKey() ||
                            anchorKey === block.getKey());

                    if (isAtEnd) {
                        event?.preventDefault();

                        // Remove trailing empty line content
                        const last = block.getLastChild();
                        if (
                            last &&
                            $isTextNode(last) &&
                            last.getTextContent() === ""
                        ) {
                            const prev = last.getPreviousSibling();
                            last.remove();
                            if (prev && $isLineBreakNode(prev)) {
                                prev.remove();
                            }
                        }

                        return $exitAfterBlock(block);
                    }
                }

                return false;
            },
            COMMAND_PRIORITY_HIGH
        );

        // ── 3. DOWN ARROW at end of last block → ensure paragraph ──
        const unregDown = editor.registerCommand(
            KEY_ARROW_DOWN_COMMAND,
            () => {
                const selection = $getSelection();
                if (!$isRangeSelection(selection) || !selection.isCollapsed())
                    return false;

                const anchorNode = selection.anchor.getNode();
                const block = $findBlockAncestor(anchorNode);
                if (!block) return false;

                // Only act if this block is the last child of root
                const root = $getRoot();
                if (block !== root.getLastChild()) return false;

                // Check if the cursor is near the end of this block
                const lastDesc = block.getLastDescendant();
                if (!lastDesc) return false;

                const anchorKey = selection.anchor.key;
                if (
                    anchorKey !== lastDesc.getKey() &&
                    anchorKey !== block.getKey()
                )
                    return false;

                return $exitAfterBlock(block);
            },
            COMMAND_PRIORITY_LOW
        );

        // ── 4. TRAILING PARAGRAPH GUARANTEE ─────────────────────────
        const unregUpdate = editor.registerUpdateListener(
            ({ editorState, dirtyElements }) => {
                // Only check when there are actual content changes
                if (dirtyElements.size === 0) return;

                editorState.read(() => {
                    const root = $getRoot();
                    const last = root.getLastChild();

                    if (last && !$isParagraphNode(last)) {
                        editor.update(
                            () => {
                                const root = $getRoot();
                                const last = root.getLastChild();
                                if (last && !$isParagraphNode(last)) {
                                    root.append($createParagraphNode());
                                }
                            },
                            { tag: "trailing-paragraph" }
                        );
                    }
                });
            }
        );

        return () => {
            unregEsc();
            unregEnter();
            unregDown();
            unregUpdate();
        };
    }, [editor]);

    return null;
}
