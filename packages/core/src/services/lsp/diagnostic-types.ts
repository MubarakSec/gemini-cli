/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @license
 */

export interface DiagnosticRange {
  start: {
    line: number;
    character: number;
  };
  end: {
    line: number;
    character: number;
  };
}

export interface Diagnostic {
  message: string;
  severity: 'Error' | 'Warning' | 'Info' | 'Hint';
  range: DiagnosticRange;
  source?: string;
  code?: string;
}

export interface DiagnosticFile {
  uri: string;
  diagnostics: Diagnostic[];
}
