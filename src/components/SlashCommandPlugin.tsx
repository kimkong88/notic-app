import { useEffect, useState, useRef, useCallback } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
    $getSelection,
    $isRangeSelection,
    $setSelection,
    $createRangeSelection,
    $createPoint,
    KEY_DOWN_COMMAND,
    COMMAND_PRIORITY_CRITICAL,
    KEY_ESCAPE_COMMAND,
    COMMAND_PRIORITY_LOW,
    FORMAT_TEXT_COMMAND,
} from "lexical";
import { $getRoot, $createParagraphNode, $createTextNode } from "lexical";
import { $isParagraphNode, $isTextNode } from "lexical";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import { $createHorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { $insertList } from "@lexical/list";
import { mergeRegister } from "@lexical/utils";
import {
    Type,
    Heading2,
    Heading3,
    Bold,
    Italic,
    Strikethrough,
    Code,
    List,
    ListOrdered,
    ListTodo,
    Quote,
    Minus,
    Link as LinkIcon,
    Image,
} from "lucide-react";
import { TOGGLE_LINK_COMMAND } from "@lexical/link";
import { uploadImage } from "../api/upload";
import { $createImageNode } from "../nodes/ImageNode";

type SavedSelection = {
    anchorKey: string;
    anchorOffset: number;
    anchorType: "text" | "element";
    focusKey: string;
    focusOffset: number;
    focusType: "text" | "element";
};

function stripLeadingSlash(text: string): string {
    const t = text.replace(/^\/\s*/, "");
    return t;
}

export function SlashCommandPlugin() {
    const [editor] = useLexicalComposerContext();
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const savedSelectionRef = useRef<SavedSelection | null>(null);

    const hideStrip = useCallback(() => {
        setVisible(false);
        savedSelectionRef.current = null;
    }, []);

    const restoreSelection = useCallback(() => {
        const saved = savedSelectionRef.current;
        if (!saved) return;
        const anchor = $createPoint(
            saved.anchorKey,
            saved.anchorOffset,
            saved.anchorType
        );
        const focus = $createPoint(
            saved.focusKey,
            saved.focusOffset,
            saved.focusType
        );
        const sel = $createRangeSelection();
        (sel as { anchor: typeof anchor; focus: typeof focus }).anchor = anchor;
        (sel as { anchor: typeof anchor; focus: typeof focus }).focus = focus;
        $setSelection(sel);
    }, []);

    const insertSlashAndHide = useCallback(() => {
        const saved = savedSelectionRef.current;
        hideStrip();
        editor.focus();
        if (saved) {
            editor.update(() => {
                const ap = $createPoint(
                    saved.anchorKey,
                    saved.anchorOffset,
                    saved.anchorType
                );
                const fp = $createPoint(
                    saved.focusKey,
                    saved.focusOffset,
                    saved.focusType
                );
                const sel = $createRangeSelection();
                (sel as { anchor: typeof ap; focus: typeof fp }).anchor = ap;
                (sel as { anchor: typeof ap; focus: typeof fp }).focus = fp;
                $setSelection(sel);
                sel.insertText("/");
            });
        }
    }, [editor, hideStrip]);

    const applyAndClose = useCallback(
        (fn: () => void) => {
            try {
                fn();
            } finally {
                hideStrip();
                editor.focus();
            }
        },
        [editor, hideStrip]
    );

    const replaceBlockWithHeading = useCallback(
        (level: 1 | 2 | 3) => {
            applyAndClose(() => {
                editor.update(() => {
                    restoreSelection();
                    const sel = $getSelection();
                    if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
                    const anchor = sel.anchor.getNode();
                    const block = anchor.getTopLevelElement();
                    if (!block) return;
                    const text = stripLeadingSlash(block.getTextContent());
                    const tag = `h${level}` as "h1" | "h2" | "h3";
                    const heading = $createHeadingNode(tag);
                    if (text.length > 0) heading.append($createTextNode(text));
                    block.replace(heading);
                    heading.selectEnd();
                });
            });
        },
        [editor, restoreSelection, applyAndClose]
    );

    const replaceBlockWithQuote = useCallback(() => {
        applyAndClose(() => {
            editor.update(() => {
                restoreSelection();
                const sel = $getSelection();
                if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
                const anchor = sel.anchor.getNode();
                const block = anchor.getTopLevelElement();
                if (!block) return;
                const text = stripLeadingSlash(block.getTextContent());
                const quote = $createQuoteNode();
                const para = $createParagraphNode();
                if (text.length > 0) para.append($createTextNode(text));
                quote.append(para);
                block.replace(quote);
                para.selectEnd();
            });
        });
    }, [editor, restoreSelection, applyAndClose]);

    const insertHorizontalRule = useCallback(() => {
        applyAndClose(() => {
            editor.update(() => {
                restoreSelection();
                const sel = $getSelection();
                if (!$isRangeSelection(sel)) return;
                const anchor = sel.anchor.getNode();
                const block = anchor.getTopLevelElement();
                if (!block) return;
                const hr = $createHorizontalRuleNode();
                const para = $createParagraphNode();
                block.insertAfter(hr);
                hr.insertAfter(para);
                para.selectStart();
            });
        });
    }, [editor, restoreSelection, applyAndClose]);

    const formatText = useCallback(
        (format: "bold" | "italic" | "strikethrough" | "code") => {
            applyAndClose(() => {
                editor.update(() => {
                    restoreSelection();
                    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
                });
            });
        },
        [editor, restoreSelection, applyAndClose]
    );

    const insertListType = useCallback(
        (listType: "bullet" | "number" | "check") => {
            applyAndClose(() => {
                editor.update(() => {
                    restoreSelection();
                    $insertList(listType);
                });
            });
        },
        [editor, restoreSelection, applyAndClose]
    );

    const insertLink = useCallback(() => {
        applyAndClose(() => {
            const url = window.prompt("Enter URL:");
            if (url?.trim()) {
                editor.update(() => {
                    restoreSelection();
                    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url.trim());
                });
            }
        });
    }, [editor, restoreSelection, applyAndClose]);

    const triggerImageUpload = useCallback(() => {
        hideStrip();
        editor.focus();
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";
        document.body.appendChild(input);
        input.onchange = async () => {
            const file = input.files?.[0];
            input.remove();
            if (!file) return;
            try {
                const { url } = await uploadImage(file);
                editor.update(() => {
                    const root = $getRoot();
                    const sel = $getSelection();
                    if ($isRangeSelection(sel)) {
                        const anchor = sel.anchor.getNode();
                        const block = anchor.getTopLevelElement();
                        const imageNode = $createImageNode(url, "image");
                        const paragraph = $createParagraphNode();
                        paragraph.append(imageNode);
                        if (block) {
                            block.insertAfter(paragraph);
                            paragraph.selectEnd();
                        } else {
                            root.append(paragraph);
                            paragraph.selectEnd();
                        }
                    }
                });
            } catch (err) {
                console.error(
                    "Image upload failed:",
                    err instanceof Error ? err.message : err
                );
            }
        };
        input.click();
    }, [editor, hideStrip]);

    useEffect(() => {
        return mergeRegister(
            editor.registerCommand(
                KEY_DOWN_COMMAND,
                (event: KeyboardEvent) => {
                    if (
                        event?.key !== "/" ||
                        event.shiftKey ||
                        event.ctrlKey ||
                        event.metaKey
                    )
                        return false;
                    if (visible) return false;

                    let atLineStart = false;
                    let anchorKey: string | null = null;
                    let anchorOffset = 0;

                    editor.getEditorState().read(() => {
                        const selection = $getSelection();
                        if (
                            !$isRangeSelection(selection) ||
                            !selection.isCollapsed()
                        )
                            return;
                        const anchor = selection.anchor;
                        anchorKey = anchor.key;
                        anchorOffset = anchor.offset;
                        const node = anchor.getNode();
                        if ($isTextNode(node)) {
                            if (anchorOffset === 0) {
                                const parent = node.getParent();
                                if (
                                    parent &&
                                    $isParagraphNode(parent) &&
                                    parent.getFirstChild() === node
                                ) {
                                    atLineStart = true;
                                }
                            }
                        } else if ($isParagraphNode(node)) {
                            if (node.getFirstChild() === null)
                                atLineStart = true;
                        }
                    });

                    if (!atLineStart || !anchorKey) return false;

                    event.preventDefault();

                    const sel = editor
                        .getEditorState()
                        .read(() => $getSelection());
                    if (!$isRangeSelection(sel)) return false;
                    savedSelectionRef.current = {
                        anchorKey: sel.anchor.key,
                        anchorOffset: sel.anchor.offset,
                        anchorType: sel.anchor.type,
                        focusKey: sel.focus.key,
                        focusOffset: sel.focus.offset,
                        focusType: sel.focus.type,
                    };

                    const domNode = editor.getElementByKey(anchorKey);
                    if (domNode) {
                        const rect = domNode.getBoundingClientRect();
                        setPosition({ top: rect.bottom + 4, left: rect.left });
                    } else {
                        setPosition({ top: 100, left: 20 });
                    }
                    setVisible(true);
                    return true;
                },
                COMMAND_PRIORITY_CRITICAL
            ),
            editor.registerCommand(
                KEY_ESCAPE_COMMAND,
                () => {
                    if (visible) {
                        insertSlashAndHide();
                        return true;
                    }
                    return false;
                },
                COMMAND_PRIORITY_LOW
            )
        );
    }, [editor, visible, insertSlashAndHide]);

    useEffect(() => {
        if (!visible) return;
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as Node;
            const strip = document.querySelector(".slash-command-strip");
            if (strip && !strip.contains(target)) insertSlashAndHide();
        };
        document.addEventListener("mousedown", onDocClick);
        return () => document.removeEventListener("mousedown", onDocClick);
    }, [visible, insertSlashAndHide]);

    if (!visible) return null;

    const stripButtons = [
        {
            title: "Heading 1",
            Icon: Type,
            action: () => replaceBlockWithHeading(1),
        },
        {
            title: "Heading 2",
            Icon: Heading2,
            action: () => replaceBlockWithHeading(2),
        },
        {
            title: "Heading 3",
            Icon: Heading3,
            action: () => replaceBlockWithHeading(3),
        },
        { title: "Bold", Icon: Bold, action: () => formatText("bold") },
        { title: "Italic", Icon: Italic, action: () => formatText("italic") },
        {
            title: "Strikethrough",
            Icon: Strikethrough,
            action: () => formatText("strikethrough"),
        },
        { title: "Code", Icon: Code, action: () => formatText("code") },
        {
            title: "Bullet list",
            Icon: List,
            action: () => insertListType("bullet"),
        },
        {
            title: "Numbered list",
            Icon: ListOrdered,
            action: () => insertListType("number"),
        },
        {
            title: "Task list",
            Icon: ListTodo,
            action: () => insertListType("check"),
        },
        { title: "Quote", Icon: Quote, action: () => replaceBlockWithQuote() },
        { title: "Divider", Icon: Minus, action: () => insertHorizontalRule() },
        { title: "Link", Icon: LinkIcon, action: () => insertLink() },
        { title: "Image", Icon: Image, action: () => triggerImageUpload() },
    ];

    return (
        <div
            className="slash-command-strip slash-command-strip-floating"
            role="toolbar"
            aria-label="Formatting"
            style={{
                top: position.top,
                left: position.left,
            }}
        >
            {stripButtons.map(({ title, Icon, action }) => (
                <button
                    key={title}
                    type="button"
                    className="slash-command-strip-btn"
                    title={title}
                    onClick={() => action()}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    <Icon size={14} strokeWidth={2} />
                </button>
            ))}
        </div>
    );
}
