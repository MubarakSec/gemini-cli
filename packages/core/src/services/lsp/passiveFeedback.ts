/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'node:url';
import type { PublishDiagnosticsParams } from 'vscode-languageserver-protocol';
import { debugLogger } from '../../utils/debugLogger.js';
import type { DiagnosticFile } from './diagnostic-types.js';
import { registerPendingLSPDiagnostic } from './LSPDiagnosticRegistry.js';
import type { LSPServerManager } from './LSPServerManager.js';

function mapLSPSeverity(
  lspSeverity: number | undefined,
): 'Error' | 'Warning' | 'Info' | 'Hint' {
  switch (lspSeverity) {
    case 1:
      return 'Error';
    case 2:
      return 'Warning';
    case 3:
      return 'Info';
    case 4:
      return 'Hint';
    default:
      return 'Error';
  }
}

export function formatDiagnosticsForAttachment(
  params: PublishDiagnosticsParams,
): DiagnosticFile[] {
  let uri: string;
  try {
    uri = params.uri.startsWith('file://')
      ? fileURLToPath(params.uri)
      : params.uri;
  } catch (error) {
    debugLogger.debug(
      `Failed to convert URI to file path: ${params.uri}. Error: ${error}. Using original URI as fallback.`,
    );
    uri = params.uri;
  }

  const diagnostics = params.diagnostics.map(
    (diag: {
      message: string;
      severity?: number;
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      source?: string;
      code?: string | number;
    }) => ({
      message: diag.message,
      severity: mapLSPSeverity(diag.severity),
      range: {
        start: {
          line: diag.range.start.line,
          character: diag.range.start.character,
        },
        end: {
          line: diag.range.end.line,
          character: diag.range.end.character,
        },
      },
      source: diag.source,
      code:
        diag.code !== undefined && diag.code !== null
          ? String(diag.code)
          : undefined,
    }),
  );

  return [
    {
      uri,
      diagnostics,
    },
  ];
}

export type HandlerRegistrationResult = {
  totalServers: number;
  successCount: number;
  registrationErrors: Array<{ serverName: string; error: string }>;
  diagnosticFailures: Map<string, { count: number; lastError: string }>;
};

export function registerLSPNotificationHandlers(
  manager: LSPServerManager,
): HandlerRegistrationResult {
  const servers = manager.getAllServers();
  const registrationErrors: Array<{ serverName: string; error: string }> = [];
  let successCount = 0;
  const diagnosticFailures: Map<string, { count: number; lastError: string }> =
    new Map();

  for (const [serverName, serverInstance] of servers.entries()) {
    try {
      if (
        !serverInstance ||
        typeof serverInstance.onNotification !== 'function'
      ) {
        const errorMsg = !serverInstance
          ? 'Server instance is null/undefined'
          : 'Server instance has no onNotification method';

        registrationErrors.push({ serverName, error: errorMsg });
        debugLogger.error(new Error(`${errorMsg} for ${serverName}`));
        continue;
      }

      serverInstance.onNotification(
        'textDocument/publishDiagnostics',
        (params: unknown) => {
          debugLogger.debug(
            `[PASSIVE DIAGNOSTICS] Handler invoked for ${serverName}!`,
          );
          try {
            if (
              !params ||
              typeof params !== 'object' ||
              !('uri' in params) ||
              !('diagnostics' in params) ||
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion, @typescript-eslint/no-explicit-any
              !Array.isArray((params as any).diagnostics)
            ) {
              const err = new Error(
                `LSP server ${serverName} sent invalid diagnostic params (missing uri or diagnostics)`,
              );
              debugLogger.error(err);
              return;
            }

            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const diagnosticParams = params as PublishDiagnosticsParams;
            debugLogger.debug(
              `Received diagnostics from ${serverName}: ${diagnosticParams.diagnostics.length} diagnostic(s) for ${diagnosticParams.uri}`,
            );

            const diagnosticFiles =
              formatDiagnosticsForAttachment(diagnosticParams);

            const firstFile = diagnosticFiles[0];
            if (
              !firstFile ||
              diagnosticFiles.length === 0 ||
              firstFile.diagnostics.length === 0
            ) {
              debugLogger.debug(
                `Skipping empty diagnostics from ${serverName} for ${diagnosticParams.uri}`,
              );
              return;
            }

            try {
              registerPendingLSPDiagnostic({
                serverName,
                files: diagnosticFiles,
              });

              debugLogger.debug(
                `LSP Diagnostics: Registered ${diagnosticFiles.length} diagnostic file(s) from ${serverName} for async delivery`,
              );

              diagnosticFailures.delete(serverName);
            } catch (error) {
              debugLogger.error(
                new Error(
                  `Error registering LSP diagnostics from ${serverName}: ${error}`,
                ),
              );

              const failures = diagnosticFailures.get(serverName) || {
                count: 0,
                lastError: '',
              };
              failures.count++;
              failures.lastError = String(error);
              diagnosticFailures.set(serverName, failures);
            }
          } catch (error) {
            debugLogger.error(
              new Error(
                `Unexpected error processing diagnostics from ${serverName}: ${error}`,
              ),
            );

            const failures = diagnosticFailures.get(serverName) || {
              count: 0,
              lastError: '',
            };
            failures.count++;
            failures.lastError = String(error);
            diagnosticFailures.set(serverName, failures);
          }
        },
      );

      debugLogger.debug(`Registered diagnostics handler for ${serverName}`);
      successCount++;
    } catch (error) {
      registrationErrors.push({
        serverName,
        error: String(error),
      });

      debugLogger.error(
        new Error(
          `Failed to register diagnostics handler for ${serverName}: ${error}`,
        ),
      );
    }
  }

  const totalServers = servers.size;
  if (registrationErrors.length > 0) {
    const failedServers = registrationErrors
      .map((e) => `${e.serverName} (${e.error})`)
      .join(', ');
    debugLogger.error(
      new Error(
        `Failed to register diagnostics for ${registrationErrors.length} LSP server(s): ${failedServers}`,
      ),
    );
  } else {
    debugLogger.debug(
      `LSP notification handlers registered successfully for all ${totalServers} server(s)`,
    );
  }

  return {
    totalServers,
    successCount,
    registrationErrors,
    diagnosticFailures,
  };
}
