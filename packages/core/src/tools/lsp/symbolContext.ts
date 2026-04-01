/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { debugLogger } from '../../utils/debugLogger.js';

const MAX_READ_BYTES = 64 * 1024;

/**
 * Extracts the symbol/word at a specific position in a file.
 * Used to show context in tool use messages.
 *
 * @param filePath - The file path (absolute or relative)
 * @param line - 0-indexed line number
 * @param character - 0-indexed character position on the line
 *
 * Note: This uses synchronous file I/O because it is called from
 * UI rendering (a synchronous process).
 * @returns The symbol at that position, or null if extraction fails
 */
export function getSymbolAtPosition(
  filePath: string,
  line: number,
  character: number,
): string | null {
  try {
    const absolutePath = path.resolve(filePath);

    // Read only the first 64KB instead of the whole file.
    const fd = fs.openSync(absolutePath, 'r');
    const buffer = Buffer.alloc(MAX_READ_BYTES);
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, MAX_READ_BYTES, 0);
    } finally {
      fs.closeSync(fd);
    }

    const content = buffer.toString('utf-8', 0, bytesRead);
    const lines = content.split('\n');

    if (line < 0 || line >= lines.length) {
      return null;
    }

    if (bytesRead === MAX_READ_BYTES && line === lines.length - 1) {
      return null;
    }

    const lineContent = lines[line];
    if (!lineContent || character < 0 || character >= lineContent.length) {
      return null;
    }

    const symbolPattern = /[\w$'!]+|[+\-*/%&|^~<>=]+/g;
    let match: RegExpExecArray | null;

    while ((match = symbolPattern.exec(lineContent)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      if (character >= start && character < end) {
        const symbol = match[0];
        return symbol.length > 30 ? symbol.substring(0, 27) + '...' : symbol;
      }
    }

    return null;
  } catch (error) {
    if (error instanceof Error) {
      debugLogger.debug(
        `Symbol extraction failed for ${filePath}:${line}:${character}: ${error.message}`,
      );
    }
    return null;
  }
}
