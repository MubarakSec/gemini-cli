/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { debugLogger } from '../../utils/debugLogger.js';
import { getErrorMessage as errorMessage } from '../../utils/errors.js';
import {
  createLSPServerManager,
  type LSPServerManager,
} from './LSPServerManager.js';
import { registerLSPNotificationHandlers } from './passiveFeedback.js';
import type { Config } from '../../config/config.js';

type InitializationState = 'not-started' | 'pending' | 'success' | 'failed';

let lspManagerInstance: LSPServerManager | undefined;
let initializationState: InitializationState = 'not-started';
let initializationError: Error | undefined;
let initializationGeneration = 0;
let initializationPromise: Promise<void> | undefined;

export function _resetLspManagerForTesting(): void {
  initializationState = 'not-started';
  initializationError = undefined;
  initializationPromise = undefined;
  initializationGeneration++;
}

export function getLspServerManager(): LSPServerManager | undefined {
  if (initializationState === 'failed') {
    return undefined;
  }
  return lspManagerInstance;
}

export function getInitializationStatus():
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error } {
  if (initializationState === 'failed') {
    return {
      status: 'failed',
      error: initializationError || new Error('Initialization failed'),
    };
  }
  if (initializationState === 'not-started') {
    return { status: 'not-started' };
  }
  if (initializationState === 'pending') {
    return { status: 'pending' };
  }
  return { status: 'success' };
}

export function isLspConnected(): boolean {
  if (initializationState === 'failed') return false;
  const manager = getLspServerManager();
  if (!manager) return false;
  const servers = manager.getAllServers();
  if (servers.size === 0) return false;
  for (const server of servers.values()) {
    if (server.state !== 'error') return true;
  }
  return false;
}

export async function waitForInitialization(): Promise<void> {
  if (initializationState === 'success' || initializationState === 'failed') {
    return;
  }

  if (initializationState === 'pending' && initializationPromise) {
    await initializationPromise;
  }
}

export function initializeLspServerManager(config: Config): void {
  // Equivalent to isBareMode()
  if (!config.interactive) {
    return;
  }
  debugLogger.debug('[LSP MANAGER] initializeLspServerManager() called');

  if (lspManagerInstance !== undefined && initializationState !== 'failed') {
    debugLogger.debug(
      '[LSP MANAGER] Already initialized or initializing, skipping',
    );
    return;
  }

  if (initializationState === 'failed') {
    lspManagerInstance = undefined;
    initializationError = undefined;
  }

  lspManagerInstance = createLSPServerManager();
  initializationState = 'pending';
  debugLogger.debug('[LSP MANAGER] Created manager instance, state=pending');

  const currentGeneration = ++initializationGeneration;
  debugLogger.debug(
    `[LSP MANAGER] Starting async initialization (generation ${currentGeneration})`,
  );

  initializationPromise = lspManagerInstance
    .initialize()
    .then(() => {
      if (currentGeneration === initializationGeneration) {
        initializationState = 'success';
        debugLogger.debug('LSP server manager initialized successfully');

        if (lspManagerInstance) {
          registerLSPNotificationHandlers(lspManagerInstance);
        }
      }
    })
    .catch((error: unknown) => {
      if (currentGeneration === initializationGeneration) {
        initializationState = 'failed';
        initializationError =
          error instanceof Error ? error : new Error(errorMessage(error));
        lspManagerInstance = undefined;

        debugLogger.error(initializationError);
        debugLogger.debug(
          `Failed to initialize LSP server manager: ${errorMessage(error)}`,
        );
      }
    });
}

export function reinitializeLspServerManager(config: Config): void {
  if (initializationState === 'not-started') {
    return;
  }

  debugLogger.debug('[LSP MANAGER] reinitializeLspServerManager() called');

  if (lspManagerInstance) {
    void lspManagerInstance.shutdown().catch((err) => {
      debugLogger.debug(
        `[LSP MANAGER] old instance shutdown during reinit failed: ${errorMessage(err)}`,
      );
    });
  }

  lspManagerInstance = undefined;
  initializationState = 'not-started';
  initializationError = undefined;

  initializeLspServerManager(config);
}

export async function shutdownLspServerManager(): Promise<void> {
  if (lspManagerInstance === undefined) {
    return;
  }

  try {
    await lspManagerInstance.shutdown();
    debugLogger.debug('LSP server manager shut down successfully');
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(errorMessage(error));
    debugLogger.error(err);
    debugLogger.debug(
      `Failed to shutdown LSP server manager: ${errorMessage(error)}`,
    );
  } finally {
    lspManagerInstance = undefined;
    initializationState = 'not-started';
    initializationError = undefined;
    initializationPromise = undefined;
    initializationGeneration++;
  }
}
