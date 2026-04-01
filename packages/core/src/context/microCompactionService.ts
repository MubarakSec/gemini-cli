/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage as errorMessage } from '../utils/errors.js';
import type { Config } from '../config/config.js';
import { LlmRole } from '../telemetry/types.js';
import { getResponseText } from '../utils/partUtils.js';
import { DEFAULT_GEMINI_FLASH_LITE_MODEL } from '../config/models.js';

const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`;

export type ToolInfo = {
  name: string;
  input: unknown;
  output: unknown;
};

/**
 * Generates a human-readable summary of a completed tool call.
 */
export async function generateToolUseSummary(
  config: Config,
  tool: ToolInfo,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const inputStr = truncateJson(tool.input, 500);
    const outputStr = truncateJson(tool.output, 1000);
    const toolSummary = `Tool: ${tool.name}\nInput: ${inputStr}\nOutput: ${outputStr}`;

    const response = await config.getBaseLlmClient().generateContent({
      modelConfigKey: { model: DEFAULT_GEMINI_FLASH_LITE_MODEL },
      contents: [
        {
          role: 'user',
          parts: [{ text: `Tool completed:\n\n${toolSummary}\n\nLabel:` }],
        },
      ],
      systemInstruction: { text: TOOL_USE_SUMMARY_SYSTEM_PROMPT },
      promptId: 'tool-use-summary',
      abortSignal: signal ?? new AbortController().signal,
      role: LlmRole.UTILITY_SUMMARIZER,
    });

    const summary = getResponseText(response)?.trim();
    return summary || null;
  } catch (error) {
    debugLogger.debug(
      `Failed to generate tool use summary: ${errorMessage(error)}`,
    );
    return null;
  }
}

/**
 * Truncates a JSON value to a maximum length for the prompt.
 */
function truncateJson(value: unknown, maxLength: number): string {
  try {
    const str = JSON.stringify(value);
    if (str.length <= maxLength) {
      return str;
    }
    return str.slice(0, maxLength - 3) + '...';
  } catch {
    return '[unable to serialize]';
  }
}
