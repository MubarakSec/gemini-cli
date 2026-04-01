/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

import { z } from 'zod';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const listScratchpadSchema = z.object({});

type ListScratchpadParams = z.infer<typeof listScratchpadSchema>;

class ListScratchpadInvocation extends BaseToolInvocation<
  ListScratchpadParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: ListScratchpadParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  async execute(): Promise<ToolResult> {
    try {
      const scratchpadDir = this.config.storage.getScratchpadDir();
      if (!fs.existsSync(scratchpadDir)) {
        return {
          llmContent: 'Scratchpad is empty (directory does not exist).',
          returnDisplay: 'Scratchpad is empty.',
        };
      }

      const files = fs.readdirSync(scratchpadDir, { recursive: true });
      const fileList = files
        .map((f) => String(f))
        .filter((f) => {
          try {
            const fullPath = path.join(scratchpadDir, f);
            return fs.statSync(fullPath).isFile();
          } catch {
            return false;
          }
        });

      if (fileList.length === 0) {
        return {
          llmContent: 'Scratchpad is empty.',
          returnDisplay: 'Scratchpad is empty.',
        };
      }

      const content = fileList
        .map((file) => {
          const stats = fs.statSync(path.join(scratchpadDir, file));
          return `- ${file} (${stats.size} bytes)`;
        })
        .join('\n');

      return {
        llmContent: `Files in scratchpad:\n${content}\n\nNote: You can read these files using read_file and write to them using write_file by using the absolute path or prefixing with 'scratchpad/'.`,
        returnDisplay: `Found ${fileList.length} files in scratchpad.`,
      };
    } catch (error) {
      return {
        llmContent: `Error listing scratchpad: ${error}`,
        returnDisplay: 'Error listing scratchpad.',
      };
    }
  }

  getDescription(): string {
    return 'Listing temporary scratchpad files';
  }
}

export class ListScratchpadTool extends BaseDeclarativeTool<
  ListScratchpadParams,
  ToolResult
> {
  static readonly Name = 'list_scratchpad';

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      ListScratchpadTool.Name,
      'List Scratchpad',
      "Lists all temporary files stored in the agent's session-specific scratchpad directory.",
      Kind.Read,
      listScratchpadSchema,
      messageBus,
    );
  }

  protected createInvocation(
    params: ListScratchpadParams,
    messageBus: MessageBus,
  ): ToolInvocation<ListScratchpadParams, ToolResult> {
    return new ListScratchpadInvocation(
      this.config,
      params,
      messageBus,
      this.name,
      this.displayName,
    );
  }
}
