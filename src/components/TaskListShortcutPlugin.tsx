/**
 * TaskListShortcutPlugin — converts a bullet/numbered list item into a
 * check-list item when the user types "[ ] " or "[x] " at the start.
 *
 * This works around the timing issue where typing "- " instantly creates a
 * bullet list (via MarkdownShortcutPlugin) before the user can complete
 * "- [ ] " for a task list.
 *
 * Uses registerNodeTransform on ListItemNode so it handles both typing and paste.
 */

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isTextNode } from "lexical";
import { ListItemNode, $isListNode } from "@lexical/list";

export function TaskListShortcutPlugin() {
    const [editor] = useLexicalComposerContext();

    useEffect(() => {
        return editor.registerNodeTransform(ListItemNode, (node) => {
            // Only process items in bullet or number lists (not already check lists)
            const parent = node.getParent();
            if (!parent || !$isListNode(parent)) return;
            if (parent.getListType() === "check") return;

            const firstChild = node.getFirstChild();
            if (!firstChild || !$isTextNode(firstChild)) return;

            const text = firstChild.getTextContent();
            const match = text.match(/^\[( |x)\]\s/i);
            if (!match) return;

            // Convert list type to check
            parent.setListType("check");

            // Set checked state
            const isChecked = match[1].toLowerCase() === "x";
            node.setChecked(isChecked);

            // Remove the "[ ] " or "[x] " prefix
            const remaining = text.slice(match[0].length);
            firstChild.setTextContent(remaining);
        });
    }, [editor]);

    return null;
}
