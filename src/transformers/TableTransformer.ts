/**
 * Markdown ↔ Lexical table transformer.
 *
 * Handles import (markdown table → TableNode) and export (TableNode → markdown table).
 * Tables follow standard markdown format:
 *   | Header 1 | Header 2 |
 *   | --- | --- |
 *   | Cell 1 | Cell 2 |
 */

import {
    $createTableNode,
    $createTableRowNode,
    $createTableCellNode,
    $isTableNode,
    TableCellHeaderStates,
    TableNode,
    TableRowNode,
    TableCellNode,
} from "@lexical/table";
import {
    $createParagraphNode,
    $createTextNode,
    type LexicalNode,
} from "lexical";
import type { MultilineElementTransformer } from "@lexical/markdown";

const TABLE_ROW_REG_EXP = /^\|(.+)\|\s*$/;
const TABLE_ROW_DIVIDER_REG_EXP = /^(\| ?:?-+:? ?)+\|\s*$/;

export const TABLE: MultilineElementTransformer = {
    dependencies: [TableNode, TableRowNode, TableCellNode],

    export: (node: LexicalNode): string | null => {
        if (!$isTableNode(node)) return null;

        const rows = node.getChildren<TableRowNode>();
        if (rows.length === 0) return "";

        const output: string[] = [];

        rows.forEach((row, rowIndex) => {
            const cells = row.getChildren<TableCellNode>();
            const cellTexts = cells.map((cell) => {
                const text = cell.getTextContent().replace(/\|/g, "\\|").trim();
                return ` ${text || " "} `;
            });
            output.push(`|${cellTexts.join("|")}|`);

            // Add separator row after first row (header)
            if (rowIndex === 0) {
                const separators = cells.map(() => " --- ");
                output.push(`|${separators.join("|")}|`);
            }
        });

        return output.join("\n");
    },

    regExpStart: TABLE_ROW_REG_EXP,

    handleImportAfterStartMatch: ({ lines, rootNode, startLineIndex }) => {
        // Collect all consecutive table rows
        const tableLines: string[] = [];
        let lastIndex = startLineIndex;

        for (let i = startLineIndex; i < lines.length; i++) {
            const line = lines[i];
            if (
                TABLE_ROW_REG_EXP.test(line) ||
                TABLE_ROW_DIVIDER_REG_EXP.test(line)
            ) {
                tableLines.push(line);
                lastIndex = i;
            } else {
                break;
            }
        }

        // Need at least header + separator/data
        if (tableLines.length < 2) return null;

        // Filter out divider rows
        const dataRows = tableLines.filter(
            (l) => !TABLE_ROW_DIVIDER_REG_EXP.test(l)
        );
        if (dataRows.length === 0) return null;

        // Parse cells from each row
        const parsedRows = dataRows.map((line) => {
            const match = line.match(/^\|(.+)\|\s*$/);
            if (!match) return [];
            return match[1].split("|").map((cell) => cell.trim());
        });

        const columnCount = parsedRows[0]?.length || 0;
        if (columnCount === 0) return null;

        // Create table node
        const tableNode = $createTableNode();

        parsedRows.forEach((cells, rowIndex) => {
            const rowNode = $createTableRowNode();

            for (let c = 0; c < columnCount; c++) {
                const cellText = cells[c] || "";
                const isHeader = rowIndex === 0;
                const cellNode = $createTableCellNode(
                    isHeader
                        ? TableCellHeaderStates.ROW
                        : TableCellHeaderStates.NO_STATUS
                );
                const para = $createParagraphNode();
                if (cellText) {
                    para.append($createTextNode(cellText));
                }
                cellNode.append(para);
                rowNode.append(cellNode);
            }

            tableNode.append(rowNode);
        });

        rootNode.append(tableNode);
        return [true, lastIndex];
    },

    replace: () => {
        // Import is handled entirely by handleImportAfterStartMatch
        return false;
    },

    type: "multiline-element",
};
