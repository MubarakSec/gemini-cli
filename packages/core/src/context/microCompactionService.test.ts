/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateToolUseSummary } from './microCompactionService.js';
import { LlmRole } from '../telemetry/types.js';

describe('MicroCompactionService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockLlmClient: any;

  beforeEach(() => {
    mockLlmClient = {
      generateContent: vi.fn(),
    };

    mockConfig = {
      getBaseLlmClient: () => mockLlmClient,
    };
  });

  it('should generate a summary for a tool call', async () => {
    mockLlmClient.generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'Found 12 matches in auth/' }],
          },
        },
      ],
    });

    const result = await generateToolUseSummary(mockConfig, {
      name: 'grep_search',
      input: { pattern: 'login', dir_path: 'src/auth' },
      output: { matches: new Array(12).fill('match') },
    });

    expect(result).toBe('Found 12 matches in auth/');
    expect(mockLlmClient.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        role: LlmRole.UTILITY_SUMMARIZER,
        promptId: 'tool-use-summary',
      }),
    );
  });

  it('should return null if LLM fails', async () => {
    mockLlmClient.generateContent.mockRejectedValue(new Error('API Error'));

    const result = await generateToolUseSummary(mockConfig, {
      name: 'read_file',
      input: { file_path: 'large.ts' },
      output: 'very long content...',
    });

    expect(result).toBeNull();
  });
});
