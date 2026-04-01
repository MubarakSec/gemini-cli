/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdvisorService } from './advisorService.js';
import { LlmRole } from '../telemetry/llmRole.js';

describe('AdvisorService', () => {
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

  it('should generate a hint for a technical request', async () => {
    mockLlmClient.generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [{ text: 'Remember to add license headers.' }],
          },
        },
      ],
    });

    const service = new AdvisorService(mockConfig);
    const result = await service.getArchitecturalHint(
      [{ role: 'user', parts: [{ text: 'hello' }] }],
      'Create a new service in packages/core/src/services',
    );

    expect(result).toBe('Remember to add license headers.');
    expect(mockLlmClient.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        role: LlmRole.UTILITY_ROUTER,
        promptId: 'speculative-advisor',
      }),
    );
  });

  it('should return null for simple requests', async () => {
    const service = new AdvisorService(mockConfig);
    const result = await service.getArchitecturalHint([], 'hi');
    expect(result).toBeNull();
    expect(mockLlmClient.generateContent).not.toHaveBeenCalled();
  });
});
