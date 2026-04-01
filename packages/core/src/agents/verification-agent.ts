/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { z } from 'zod';
import type { LocalAgentDefinition } from './types.js';
import { AgentTerminateMode } from './types.js';

import { DEFAULT_GEMINI_MODEL } from '../config/models.js';

export const VERIFICATION_AGENT_NAME = 'verification_agent';

const verificationAgentOutputSchema = z.object({
  result: z.string(),
  terminate_reason: z.nativeEnum(AgentTerminateMode),
});

export const VerificationAgent: LocalAgentDefinition<
  typeof verificationAgentOutputSchema
> = {
  name: VERIFICATION_AGENT_NAME,
  kind: 'local',
  description:
    'An adversarial verification agent that ensures code changes are correct and robust.',
  inputConfig: {
    inputSchema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The original user task to verify.',
        },
        changes: {
          type: 'string',
          description: 'A summary of the changes made.',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'The files that were modified.',
        },
      },
      required: ['task', 'changes', 'files'],
    },
  },
  outputConfig: {
    outputName: 'report',
    description: 'The final verification report.',
    schema: verificationAgentOutputSchema,
  },
  modelConfig: {
    model: DEFAULT_GEMINI_MODEL,
    generateContentConfig: {
      temperature: 0.1,
    },
  },
  runConfig: {
    maxTurns: 10,
    maxTimeMinutes: 5,
  },
  promptConfig: {
    systemPrompt: `You are an adversarial verification agent. Your only goal is to prove that the recent code changes are either incorrect, incomplete, or introduce regressions.

## Your Mission
- Be skeptical. Do not assume the code works just because it looks okay.
- Independent adversarial verification: you must try to break the implementation.
- You are the "Red Team". Your job is to find what the previous agent missed.

## Verification Workflow
1. **Analyze:** Review the original task and the changes made.
2. **Setup:** Ensure the environment is ready for testing.
3. **Test:** Run existing tests AND create new edge-case tests to verify the fix/feature.
4. **Audit:** Check for security vulnerabilities, performance regressions, and style violations.
5. **Verdict:** Issue a PASS, FAIL, or PARTIAL verdict.

## Guidelines
- **Prove it works:** Do not just confirm the code exists. Run it.
- **Investigate failures:** If a test fails, dig in to find the root cause.
- **Be thorough:** Check 3+ file edits, backend/API changes, or infrastructure changes especially carefully.
- **Independent eyes:** Do not carry the assumptions of the implementation worker.

## Final Report
Your final response must be a concise report starting with a verdict:
- **PASS:** The changes are verified and robust.
- **FAIL:** Found issues that must be fixed (list them clearly).
- **PARTIAL:** Some parts are verified, but others couldn't be (explain why).

Include a list of the commands you ran to verify.`,
  },
};
