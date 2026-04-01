/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ChildProcess, spawn } from 'node:child_process';
import {
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  Trace,
} from 'vscode-jsonrpc/node.js';
import type {
  InitializeParams,
  InitializeResult,
  ServerCapabilities,
} from 'vscode-languageserver-protocol';
import { debugLogger } from '../../utils/debugLogger.js';
import { getErrorMessage as errorMessage } from '../../utils/errors.js';

/**
 * LSP client interface.
 */
export type LSPClient = {
  readonly capabilities: ServerCapabilities | undefined;
  readonly isInitialized: boolean;
  start: (
    command: string,
    args: string[],
    options?: {
      env?: Record<string, string>;
      cwd?: string;
    },
  ) => Promise<void>;
  initialize: (params: InitializeParams) => Promise<InitializeResult>;
  sendRequest: <TResult>(method: string, params: unknown) => Promise<TResult>;
  sendNotification: (method: string, params: unknown) => Promise<void>;
  onNotification: (method: string, handler: (params: unknown) => void) => void;
  onRequest: <TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ) => void;
  stop: () => Promise<void>;
};

/**
 * Create an LSP client wrapper using vscode-jsonrpc.
 * Manages communication with an LSP server process via stdio.
 *
 * @param onCrash - Called when the server process exits unexpectedly (non-zero
 *   exit code during operation, not during intentional stop). Allows the owner
 *   to propagate crash state so the server can be restarted on next use.
 */
export function createLSPClient(
  serverName: string,
  onCrash?: (error: Error) => void,
): LSPClient {
  // State variables in closure
  let process: ChildProcess | undefined;
  let connection: MessageConnection | undefined;
  let capabilities: ServerCapabilities | undefined;
  let isInitialized = false;
  let startFailed = false;
  let startError: Error | undefined;
  let isStopping = false; // Track intentional shutdown to avoid spurious error logging
  // Queue handlers registered before connection ready (lazy initialization support)
  const pendingHandlers: Array<{
    method: string;
    handler: (params: unknown) => void;
  }> = [];
  const pendingRequestHandlers: Array<{
    method: string;
    handler: (params: unknown) => unknown | Promise<unknown>;
  }> = [];

  function checkStartFailed(): void {
    if (startFailed) {
      throw startError || new Error(`LSP server ${serverName} failed to start`);
    }
  }

  return {
    get capabilities(): ServerCapabilities | undefined {
      return capabilities;
    },

    get isInitialized(): boolean {
      return isInitialized;
    },

    async start(
      command: string,
      args: string[],
      options?: {
        env?: Record<string, string>;
        cwd?: string;
      },
    ): Promise<void> {
      try {
        // 1. Spawn LSP server process
        process = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...globalThis.process.env, ...options?.env },
          cwd: options?.cwd,
          // Prevent visible console window on Windows (no-op on other platforms)
          windowsHide: true,
        });

        if (!process.stdout || !process.stdin) {
          throw new Error('LSP server process stdio not available');
        }

        const spawnedProcess = process; // Capture for closure
        await new Promise<void>((resolve, reject) => {
          const onSpawn = (): void => {
            cleanup();
            resolve();
          };
          const onError = (error: Error): void => {
            cleanup();
            reject(error);
          };
          const cleanup = (): void => {
            spawnedProcess.removeListener('spawn', onSpawn);
            spawnedProcess.removeListener('error', onError);
          };
          spawnedProcess.once('spawn', onSpawn);
          spawnedProcess.once('error', onError);
        });

        if (process.stderr) {
          process.stderr.on('data', (data: Buffer) => {
            const output = data.toString().trim();
            if (output) {
              debugLogger.debug(`[LSP SERVER ${serverName}] ${output}`);
            }
          });
        }

        process.on('error', (error) => {
          if (!isStopping) {
            startFailed = true;
            startError = error;
            debugLogger.error(
              new Error(
                `LSP server ${serverName} failed to start: ${error.message}`,
              ),
            );
          }
        });

        process.on('exit', (code, _signal) => {
          if (code !== 0 && code !== null && !isStopping) {
            isInitialized = false;
            startFailed = false;
            startError = undefined;
            const crashError = new Error(
              `LSP server ${serverName} crashed with exit code ${code}`,
            );
            debugLogger.error(crashError);
            onCrash?.(crashError);
          }
        });

        process.stdin.on('error', (error: Error) => {
          if (!isStopping) {
            debugLogger.debug(
              `LSP server ${serverName} stdin error: ${error.message}`,
            );
          }
        });

        const reader = new StreamMessageReader(process.stdout);
        const writer = new StreamMessageWriter(process.stdin);
        connection = createMessageConnection(reader, writer);

        connection.onError(
          ([error, _message, _code]: [Error, unknown, number | undefined]) => {
            if (!isStopping) {
              startFailed = true;
              startError = error;
              debugLogger.error(
                new Error(
                  `LSP server ${serverName} connection error: ${errorMessage(error)}`,
                ),
              );
            }
          },
        );

        connection.onClose(() => {
          if (!isStopping) {
            isInitialized = false;
            debugLogger.debug(`LSP server ${serverName} connection closed`);
          }
        });

        connection.listen();

        connection
          .trace(Trace.Verbose, {
            log: (message: string) => {
              debugLogger.debug(`[LSP PROTOCOL ${serverName}] ${message}`);
            },
          })
          .catch((error: Error) => {
            debugLogger.debug(
              `Failed to enable tracing for ${serverName}: ${error.message}`,
            );
          });

        for (const { method, handler } of pendingHandlers) {
          connection.onNotification(method, handler);
          debugLogger.debug(
            `Applied queued notification handler for ${serverName}.${method}`,
          );
        }
        pendingHandlers.length = 0;

        for (const { method, handler } of pendingRequestHandlers) {
          connection.onRequest(method, handler);
          debugLogger.debug(
            `Applied queued request handler for ${serverName}.${method}`,
          );
        }
        pendingRequestHandlers.length = 0;

        debugLogger.debug(`LSP client started for ${serverName}`);
      } catch (error) {
        debugLogger.error(
          new Error(
            `LSP server ${serverName} failed to start: ${errorMessage(error)}`,
          ),
        );
        throw error;
      }
    },

    async initialize(params: InitializeParams): Promise<InitializeResult> {
      if (!connection) {
        throw new Error('LSP client not started');
      }

      checkStartFailed();

      try {
        const result: InitializeResult = await connection.sendRequest(
          'initialize',
          params,
        );

        capabilities = result.capabilities;

        await connection.sendNotification('initialized', {});

        isInitialized = true;
        debugLogger.debug(`LSP server ${serverName} initialized`);

        return result;
      } catch (error) {
        debugLogger.error(
          new Error(
            `LSP server ${serverName} initialize failed: ${errorMessage(error)}`,
          ),
        );
        throw error;
      }
    },

    async sendRequest<TResult>(
      method: string,
      params: unknown,
    ): Promise<TResult> {
      if (!connection) {
        throw new Error('LSP client not started');
      }

      checkStartFailed();

      if (!isInitialized) {
        throw new Error('LSP server not initialized');
      }

      try {
        return await connection.sendRequest(method, params);
      } catch (error) {
        debugLogger.error(
          new Error(
            `LSP server ${serverName} request ${method} failed: ${errorMessage(error)}`,
          ),
        );
        throw error;
      }
    },

    async sendNotification(method: string, params: unknown): Promise<void> {
      if (!connection) {
        throw new Error('LSP client not started');
      }

      checkStartFailed();

      try {
        await connection.sendNotification(method, params);
      } catch (error) {
        debugLogger.error(
          new Error(
            `LSP server ${serverName} notification ${method} failed: ${errorMessage(error)}`,
          ),
        );
        debugLogger.debug(`Notification ${method} failed but continuing`);
      }
    },

    onNotification(method: string, handler: (params: unknown) => void): void {
      if (!connection) {
        pendingHandlers.push({ method, handler });
        debugLogger.debug(
          `Queued notification handler for ${serverName}.${method} (connection not ready)`,
        );
        return;
      }

      checkStartFailed();

      connection.onNotification(method, handler);
    },

    onRequest<TParams, TResult>(
      method: string,
      handler: (params: TParams) => TResult | Promise<TResult>,
    ): void {
      if (!connection) {
        pendingRequestHandlers.push({
          method,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          handler: handler as (params: unknown) => unknown | Promise<unknown>,
        });
        debugLogger.debug(
          `Queued request handler for ${serverName}.${method} (connection not ready)`,
        );
        return;
      }

      checkStartFailed();

      connection.onRequest(method, handler);
    },

    async stop(): Promise<void> {
      let shutdownError: Error | undefined;

      isStopping = true;

      try {
        if (connection) {
          await connection.sendRequest('shutdown', {});
          await connection.sendNotification('exit', {});
        }
      } catch (error) {
        debugLogger.error(
          new Error(
            `LSP server ${serverName} stop failed: ${errorMessage(error)}`,
          ),
        );
        shutdownError =
          error instanceof Error ? error : new Error(errorMessage(error));
      } finally {
        if (connection) {
          try {
            connection.dispose();
          } catch (error) {
            debugLogger.debug(
              `Connection disposal failed for ${serverName}: ${errorMessage(error)}`,
            );
          }
          connection = undefined;
        }

        if (process) {
          process.removeAllListeners('error');
          process.removeAllListeners('exit');
          if (process.stdin) {
            process.stdin.removeAllListeners('error');
          }
          if (process.stderr) {
            process.stderr.removeAllListeners('data');
          }

          try {
            process.kill();
          } catch (error) {
            debugLogger.debug(
              `Process kill failed for ${serverName} (may already be dead): ${errorMessage(error)}`,
            );
          }
          process = undefined;
        }

        isInitialized = false;
        capabilities = undefined;
        isStopping = false;

        if (shutdownError) {
          startFailed = true;
          startError = shutdownError;
        }

        debugLogger.debug(`LSP client stopped for ${serverName}`);
      }

      if (shutdownError) {
        throw shutdownError;
      }
    },
  };
}
