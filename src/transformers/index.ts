/**
 * Shared markdown transformer list used by NoteEditor, paste, and copy plugins.
 */

import type { Transformer } from "@lexical/markdown";
import {
    HEADING,
    QUOTE,
    CHECK_LIST,
    UNORDERED_LIST,
    ORDERED_LIST,
    MULTILINE_ELEMENT_TRANSFORMERS,
    TEXT_FORMAT_TRANSFORMERS,
    TEXT_MATCH_TRANSFORMERS,
} from "@lexical/markdown";
import { IMAGE } from "../nodes/ImageNode";
import { TABLE } from "./TableTransformer";

/** Markdown transformers: TABLE + CHECK_LIST before UNORDERED_LIST; IMAGE before other text-match. */
export const MARKDOWN_TRANSFORMERS: Transformer[] = [
    TABLE,
    HEADING,
    QUOTE,
    CHECK_LIST,
    UNORDERED_LIST,
    ORDERED_LIST,
    ...MULTILINE_ELEMENT_TRANSFORMERS,
    ...TEXT_FORMAT_TRANSFORMERS,
    IMAGE,
    ...TEXT_MATCH_TRANSFORMERS,
];
