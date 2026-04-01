/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

// NOTE: This file was reconstructed based on usage in other files
// because the original was missing.

export type LspServerState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

/**
 * LSP server configuration from a plugin, before scoping.
 */
export interface LspServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workspaceFolder?: string;
  extensionToLanguage: Record<string, string>;
  initializationOptions?: object;
  maxRestarts?: number;
  startupTimeout?: number;
  restartOnCrash?: boolean; // Not implemented
  shutdownTimeout?: number; // Not implemented
}

/**
 * LSP server configuration after being scoped to a plugin.
 * Includes additional metadata about the plugin source.
 */
export interface ScopedLspServerConfig extends LspServerConfig {
  pluginName: string;
  pluginVersion: string;
}
