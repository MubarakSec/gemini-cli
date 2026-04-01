/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import type { Config } from '../config/config.js';
import { DEFAULT_GEMINI_FLASH_LITE_MODEL } from '../config/models.js';
import { LlmRole } from '../telemetry/llmRole.js';
import { getResponseText } from '../utils/partUtils.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage as errorMessage } from '../utils/errors.js';
import type { Content } from '@google/genai';

const ADVISOR_SYSTEM_PROMPT = `You are a Senior Software Architect. Your job is to provide ONE critical technical hint or a potential "gotcha" for the implementation agent based on the user's request.

## Rules:
- Be extremely concise (max 20 words).
- Focus on architectural constraints, library quirks, or common bugs.
- Do NOT provide code unless absolutely necessary.
- If the request is simple, do NOT provide a hint.
- Your hint will be injected as a <system-reminder>.

Example hints:
- "Remember that 'didChange' must be sent before 'didSave' for LSP synchronization."
- "The project uses a custom 'errorMessage' utility; avoid using 'error.message' directly."
- "Ensure all new source files include the Apache-2.0 license header."`;

/**
 * Speculative Advisor Service.
 * Runs fast queries in the background to provide architectural guidance.
 */
export class AdvisorService {
  constructor(private readonly config: Config) {}

  /**
   * Generates an architectural hint based on the recent history and user request.
   */
  async getArchitecturalHint(
    history: readonly Content[],
    userRequest: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      // Don't run advisor for very short histories unless requested
      if (history.length < 2 && userRequest.length < 20) {
        return null;
      }

      const response = await this.config.getBaseLlmClient().generateContent({
        modelConfigKey: { model: DEFAULT_GEMINI_FLASH_LITE_MODEL },
        contents: [
          ...history.slice(-5), // Recent context
          {
            role: 'user',
            parts: [
              { text: `User Request: ${userRequest}\n\nArchitecture Hint:` },
            ],
          },
        ],
        systemInstruction: { text: ADVISOR_SYSTEM_PROMPT },
        promptId: 'speculative-advisor',
        abortSignal: signal ?? new AbortController().signal,
        role: LlmRole.UTILITY_ROUTER, // Re-using router role for architect
        maxAttempts: 1,
      });

      const hint = getResponseText(response)?.trim();
      if (!hint || hint.toLowerCase().includes('no hint') || hint.length < 5) {
        return null;
      }

      return hint;
    } catch (error) {
      debugLogger.debug(
        `[Advisor] Failed to generate hint: ${errorMessage(error)}`,
      );
      return null;
    }
  }

  /**
   * Formats the hint for injection into the model conversation.
   */
  formatHintForInjection(hint: string): string {
    return `<system-reminder>\n**Architect Advisor:** ${hint}\n</system-reminder>`;
  }
}
