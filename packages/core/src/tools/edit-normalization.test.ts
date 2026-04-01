/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EditTool } from './edit.js';

describe('EditTool Normalization', () => {
   
  let editTool: EditTool;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockConfig: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockMessageBus: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockFs: any;

  beforeEach(() => {
    mockFs = {
      readTextFile: vi.fn(),
      writeTextFile: vi.fn(),
      access: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };

    mockConfig = {
      getTargetDir: () => '/mock/dir',
      getFileSystemService: () => mockFs,
      getFileService: () => ({
        findFiles: vi.fn().mockResolvedValue([]),
      }),
      getFileFilteringOptions: () => ({}),
      validatePathAccess: () => null,
      getApprovalMode: () => 'always',
      isPlanMode: () => false,
      getDisableLLMCorrection: () => true,
      getBaseLlmClient: () => ({}),
      getGitService: () => null,
      getWorkspaceContext: () => ({
        getDirectories: () => ['/mock/dir'],
      }),
      getUsageStatisticsEnabled: () => false,
      isInteractive: () => true,
      getPromptCacheBreakDetectionEnabled: () => false,
      getMaxAttempts: () => 3,
    };

    mockMessageBus = {
      send: vi.fn(),
    };

    editTool = new EditTool(mockConfig, mockMessageBus);
  });

  it('should match code with curly quotes when search string has straight quotes (Exact)', async () => {
    const filePath = 'test.ts';
    const originalContent = 'const greeting = “Hello World”;';
    const oldString = 'const greeting = "Hello World";';
    const newString = 'const greeting = "Hi there";';

    mockFs.readTextFile.mockResolvedValue(originalContent);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invocation = (editTool as any).createInvocation(
      {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      mockMessageBus,
    );

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Successfully modified file');
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining(filePath),
      'const greeting = "Hi there";',
    );
  });

  it('should match code with different indentation (Flexible)', async () => {
    const filePath = 'test.ts';
    const originalContent = '  function test() {\n    console.log("hi");\n  }';
    const oldString = 'function test() {\n  console.log("hi");\n}';
    const newString = 'function test() {\n  console.log("hello");\n}';

    mockFs.readTextFile.mockResolvedValue(originalContent);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invocation = (editTool as any).createInvocation(
      {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      mockMessageBus,
    );

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Successfully modified file');
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining(filePath),
      '  function test() {\n    console.log("hello");\n  }',
    );
  });

  it('should match with mixed quotes in regex mode', async () => {
    const filePath = 'test.ts';
    const originalContent = 'const a = “double”; const b = ‘single’;';
    const oldString = 'const a = "double"; const b = \'single\';';
    const newString = 'const a = "fixed"; const b = \'fixed\';';

    mockFs.readTextFile.mockResolvedValue(originalContent);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const invocation = (editTool as any).createInvocation(
      {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
      mockMessageBus,
    );

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Successfully modified file');
    expect(mockFs.writeTextFile).toHaveBeenCalledWith(
      expect.stringContaining(filePath),
      'const a = "fixed"; const b = \'fixed\';',
    );
  });
});
