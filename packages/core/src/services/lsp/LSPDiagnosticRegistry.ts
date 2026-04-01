/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomUUID } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { debugLogger } from '../../utils/debugLogger.js';
import type { DiagnosticFile } from './diagnostic-types.js';

export type PendingLSPDiagnostic = {
  serverName: string;
  files: DiagnosticFile[];
  timestamp: number;
  attachmentSent: boolean;
};

const MAX_DIAGNOSTICS_PER_FILE = 10;
const MAX_TOTAL_DIAGNOSTICS = 30;
const MAX_DELIVERED_FILES = 500;

const pendingDiagnostics = new Map<string, PendingLSPDiagnostic>();

const deliveredDiagnostics = new LRUCache<string, Set<string>>({
  max: MAX_DELIVERED_FILES,
});

export function registerPendingLSPDiagnostic({
  serverName,
  files,
}: {
  serverName: string;
  files: DiagnosticFile[];
}): void {
  const diagnosticId = randomUUID();

  debugLogger.debug(
    `LSP Diagnostics: Registering ${files.length} diagnostic file(s) from ${serverName} (ID: ${diagnosticId})`,
  );

  pendingDiagnostics.set(diagnosticId, {
    serverName,
    files,
    timestamp: Date.now(),
    attachmentSent: false,
  });
}

function severityToNumber(severity: string | undefined): number {
  switch (severity) {
    case 'Error':
      return 1;
    case 'Warning':
      return 2;
    case 'Info':
      return 3;
    case 'Hint':
      return 4;
    default:
      return 4;
  }
}

function createDiagnosticKey(diag: {
  message: string;
  severity?: string;
  range?: unknown;
  source?: string;
  code?: unknown;
}): string {
  return JSON.stringify({
    message: diag.message,
    severity: diag.severity,
    range: diag.range,
    source: diag.source || null,
    code: diag.code || null,
  });
}

function deduplicateDiagnosticFiles(
  allFiles: DiagnosticFile[],
): DiagnosticFile[] {
  const fileMap = new Map<string, Set<string>>();
  const dedupedFiles: DiagnosticFile[] = [];

  for (const file of allFiles) {
    if (!fileMap.has(file.uri)) {
      fileMap.set(file.uri, new Set());
      dedupedFiles.push({ uri: file.uri, diagnostics: [] });
    }

    const seenDiagnostics = fileMap.get(file.uri)!;
    const dedupedFile = dedupedFiles.find((f) => f.uri === file.uri)!;

    const previouslyDelivered = deliveredDiagnostics.get(file.uri) || new Set();

    for (const diag of file.diagnostics) {
      try {
        const key = createDiagnosticKey(diag);

        if (seenDiagnostics.has(key) || previouslyDelivered.has(key)) {
          continue;
        }

        seenDiagnostics.add(key);
        dedupedFile.diagnostics.push(diag);
      } catch (error: unknown) {
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>';
        debugLogger.error(
          new Error(
            `Failed to deduplicate diagnostic in ${file.uri}: ${error}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        );
        dedupedFile.diagnostics.push(diag);
      }
    }
  }

  return dedupedFiles.filter((f) => f.diagnostics.length > 0);
}

export function checkForLSPDiagnostics(): Array<{
  serverName: string;
  files: DiagnosticFile[];
}> {
  debugLogger.debug(
    `LSP Diagnostics: Checking registry - ${pendingDiagnostics.size} pending`,
  );

  const allFiles: DiagnosticFile[] = [];
  const serverNames = new Set<string>();
  const diagnosticsToMark: PendingLSPDiagnostic[] = [];

  for (const diagnostic of pendingDiagnostics.values()) {
    if (!diagnostic.attachmentSent) {
      allFiles.push(...diagnostic.files);
      serverNames.add(diagnostic.serverName);
      diagnosticsToMark.push(diagnostic);
    }
  }

  if (allFiles.length === 0) {
    return [];
  }

  let dedupedFiles: DiagnosticFile[];
  try {
    dedupedFiles = deduplicateDiagnosticFiles(allFiles);
  } catch (error: unknown) {
    debugLogger.error(
      new Error(`Failed to deduplicate LSP diagnostics: ${error}`),
    );
    dedupedFiles = allFiles;
  }

  for (const diagnostic of diagnosticsToMark) {
    diagnostic.attachmentSent = true;
  }
  for (const [id, diagnostic] of pendingDiagnostics) {
    if (diagnostic.attachmentSent) {
      pendingDiagnostics.delete(id);
    }
  }

  const originalCount = allFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  );
  const dedupedCount = dedupedFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  );

  if (originalCount > dedupedCount) {
    debugLogger.debug(
      `LSP Diagnostics: Deduplication removed ${originalCount - dedupedCount} duplicate diagnostic(s)`,
    );
  }

  let totalDiagnostics = 0;
  let truncatedCount = 0;
  for (const file of dedupedFiles) {
    file.diagnostics.sort(
      (a, b) => severityToNumber(a.severity) - severityToNumber(b.severity),
    );

    if (file.diagnostics.length > MAX_DIAGNOSTICS_PER_FILE) {
      truncatedCount += file.diagnostics.length - MAX_DIAGNOSTICS_PER_FILE;
      file.diagnostics = file.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_FILE);
    }

    const remainingCapacity = MAX_TOTAL_DIAGNOSTICS - totalDiagnostics;
    if (file.diagnostics.length > remainingCapacity) {
      truncatedCount += file.diagnostics.length - remainingCapacity;
      file.diagnostics = file.diagnostics.slice(0, remainingCapacity);
    }

    totalDiagnostics += file.diagnostics.length;
  }

  dedupedFiles = dedupedFiles.filter((f) => f.diagnostics.length > 0);

  if (truncatedCount > 0) {
    debugLogger.debug(
      `LSP Diagnostics: Volume limiting removed ${truncatedCount} diagnostic(s) (max ${MAX_DIAGNOSTICS_PER_FILE}/file, ${MAX_TOTAL_DIAGNOSTICS} total)`,
    );
  }

  for (const file of dedupedFiles) {
    if (!deliveredDiagnostics.has(file.uri)) {
      deliveredDiagnostics.set(file.uri, new Set());
    }
    const delivered = deliveredDiagnostics.get(file.uri)!;
    for (const diag of file.diagnostics) {
      try {
        delivered.add(createDiagnosticKey(diag));
      } catch (error: unknown) {
        const truncatedMessage =
          diag.message?.substring(0, 100) || '<no message>';
        debugLogger.error(
          new Error(
            `Failed to track delivered diagnostic in ${file.uri}: ${error}. ` +
              `Diagnostic message: ${truncatedMessage}`,
          ),
        );
      }
    }
  }

  const finalCount = dedupedFiles.reduce(
    (sum, f) => sum + f.diagnostics.length,
    0,
  );

  if (finalCount === 0) {
    debugLogger.debug(
      `LSP Diagnostics: No new diagnostics to deliver (all filtered by deduplication)`,
    );
    return [];
  }

  debugLogger.debug(
    `LSP Diagnostics: Delivering ${dedupedFiles.length} file(s) with ${finalCount} diagnostic(s) from ${serverNames.size} server(s)`,
  );

  return [
    {
      serverName: Array.from(serverNames).join(', '),
      files: dedupedFiles,
    },
  ];
}

export function clearAllLSPDiagnostics(): void {
  debugLogger.debug(
    `LSP Diagnostics: Clearing ${pendingDiagnostics.size} pending diagnostic(s)`,
  );
  pendingDiagnostics.clear();
}

export function resetAllLSPDiagnosticState(): void {
  debugLogger.debug(
    `LSP Diagnostics: Resetting all state (${pendingDiagnostics.size} pending, ${deliveredDiagnostics.size} files tracked)`,
  );
  pendingDiagnostics.clear();
  deliveredDiagnostics.clear();
}

export function clearDeliveredDiagnosticsForFile(fileUri: string): void {
  if (deliveredDiagnostics.has(fileUri)) {
    debugLogger.debug(
      `LSP Diagnostics: Clearing delivered diagnostics for ${fileUri}`,
    );
    deliveredDiagnostics.delete(fileUri);
  }
}

export function getPendingLSPDiagnosticCount(): number {
  return pendingDiagnostics.size;
}
