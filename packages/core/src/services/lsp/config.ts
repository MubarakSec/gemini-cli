/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ScopedLspServerConfig } from './types.js';
import { debugLogger } from '../../utils/debugLogger.js';

/**
 * Returns a hardcoded configuration for the TypeScript language server.
 * In the future, this could be expanded to load from user settings or plugins.
 */
export async function getAllLspServers(): Promise<{
  servers: Record<string, ScopedLspServerConfig>;
}> {
  const allServers: Record<string, ScopedLspServerConfig> = {};

  // Hardcoded configuration for TypeScript
  const tsServerName = 'typescript-language-server';
  allServers[tsServerName] = {
    pluginName: 'builtin-typescript',
    pluginVersion: '1.0.0',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensionToLanguage: {
      '.ts': 'typescript',
      '.tsx': 'typescriptreact',
      '.js': 'javascript',
      '.jsx': 'javascriptreact',
    },
  };

  debugLogger.debug(
    `Total LSP servers loaded: ${Object.keys(allServers).length}`,
  );

  return {
    servers: allServers,
  };
}
