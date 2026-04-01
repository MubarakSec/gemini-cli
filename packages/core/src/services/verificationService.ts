/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { EDIT_TOOL_NAME, WRITE_FILE_TOOL_NAME } from '../tools/tool-names.js';
import type { Content } from '@google/genai';

const NON_TRIVIAL_THRESHOLD = 3;

/**
 * Manages the "Verification Contract" state for an agent session.
 */
export class VerificationService {
  private lastVerifiedHistoryIndex = -1;
  private currentVerdict: 'PASS' | 'FAIL' | 'PARTIAL' | 'NONE' = 'PASS'; // Start with PASS

  /**
   * Analyzes history to see if verification is recommended.
   * "Non-trivial" changes are defined as 3+ file edits/writes since last verification.
   */
  shouldNudgeVerification(history: readonly Content[]): boolean {
    let modificationCount = 0;

    // Only look at messages AFTER the last verification
    for (let i = history.length - 1; i > this.lastVerifiedHistoryIndex; i--) {
      const content = history[i];
      if (content.parts) {
        for (const part of content.parts) {
          if (part.functionCall) {
            if (
              part.functionCall.name === EDIT_TOOL_NAME ||
              part.functionCall.name === WRITE_FILE_TOOL_NAME
            ) {
              modificationCount++;
            }
          }
        }
      }
    }

    return modificationCount >= NON_TRIVIAL_THRESHOLD;
  }

  /**
   * Updates the service with the result of a verification.
   */
  registerVerification(
    historyIndex: number,
    verdict: 'PASS' | 'FAIL' | 'PARTIAL',
  ): void {
    this.lastVerifiedHistoryIndex = historyIndex;
    this.currentVerdict = verdict;
  }

  getCurrentVerdict(): string {
    return this.currentVerdict;
  }

  /**
   * Returns a system reminder message to nudge the agent toward verification.
   */
  getVerificationNudge(): string {
    return `<system-reminder>
You have made ${NON_TRIVIAL_THRESHOLD}+ file modifications. According to the **Verification Contract**, you MUST now spawn the \`verification_agent\` to adversarialy audit your changes before reporting completion.
</system-reminder>`;
  }
}
