/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { EventEmitter } from 'node:events';

export interface GeminiHint {
  type: string;
  value: string;
  data?: Record<string, unknown>;
}

/**
 * Manages side-channel hints emitted by tools.
 * Hints are actionable UI elements surfaced to the user but hidden from the LLM.
 */
export class HintService extends EventEmitter {
  private static readonly HINT_EVENT = 'hint';

  /**
   * Broadcasts a hint to all listeners (e.g., the CLI UI).
   */
  emitHint(hint: GeminiHint): void {
    this.emit(HintService.HINT_EVENT, hint);
  }

  /**
   * Listens for hints.
   */
  onHint(handler: (hint: GeminiHint) => void): void {
    this.on(HintService.HINT_EVENT, handler);
  }

  /**
   * Scans a string for <gemini-hint /> tags and extracts them.
   * Returns the hints found and the string with hints removed.
   */
  static extractHints(text: string): { text: string; hints: GeminiHint[] } {
    const hints: GeminiHint[] = [];
    const regex = /<gemini-hint\s+([^>]*)?\/>/g;

    const newText = text.replace(regex, (_, attrs) => {
      const hint: GeminiHint = { type: 'unknown', value: '' };
      if (attrs) {
        // Simple attribute parser
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const typeMatch = attrs.match(/type=["']([^"']*)["']/);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const valueMatch = attrs.match(/value=["']([^"']*)["']/);
        if (typeMatch && typeMatch[1]) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          hint.type = typeMatch[1] as string;
        }
        if (valueMatch && valueMatch[1]) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          hint.value = valueMatch[1] as string;
        }
      }
      hints.push(hint);
      return ''; // Remove from text
    });

    return { text: newText.trim(), hints };
  }
}
