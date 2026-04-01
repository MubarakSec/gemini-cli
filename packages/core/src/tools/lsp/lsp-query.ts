/* eslint-disable */
import { open } from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type {
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
} from 'vscode-languageserver-types';
import {
  getInitializationStatus,
  getLspServerManager,
  isLspConnected,
  waitForInitialization,
} from '../../services/lsp/manager.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolLocation,
  type ToolResult,
} from '../tools.js';
import { debugLogger } from '../../utils/debugLogger.js';
import {
  formatDocumentSymbolResult,
  formatFindReferencesResult,
  formatGoToDefinitionResult,
  formatHoverResult,
  formatIncomingCallsResult,
  formatOutgoingCallsResult,
  formatPrepareCallHierarchyResult,
  formatWorkspaceSymbolResult,
} from './formatters.js';
import { DESCRIPTION, LSP_TOOL_NAME } from './prompt.js';
import { lspToolInputSchema, type LSPToolInput } from './schemas.js';
import type { Config } from '../../config/config.js';
import type { MessageBus } from '../../confirmation-bus/message-bus.js';
import { getErrorMessage as errorMessage } from '../../utils/errors.js';

const MAX_LSP_FILE_SIZE_BYTES = 10_000_000;

class LSPQueryToolInvocation extends BaseToolInvocation<
  LSPToolInput,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: LSPToolInput,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  async execute(): Promise<ToolResult> {
    const input = this.params;
    const absolutePath = path.resolve(
      this.config.getTargetDir(),
      input.filePath,
    );
    const cwd = this.config.getTargetDir();

    const status = getInitializationStatus();
    if (status.status === 'pending') {
      await waitForInitialization();
    }

    const manager = getLspServerManager();
    if (!manager) {
      return {
        llmContent:
          'LSP server manager not initialized. This may indicate a startup issue.',
        returnDisplay: 'Error: LSP not initialized.',
      };
    }

    const { method, params } = getMethodAndParams(input, absolutePath);

    try {
      if (!manager.isFileOpen(absolutePath)) {
        const handle = await open(absolutePath, 'r');
        try {
          const stats = await handle.stat();
          if (stats.size > MAX_LSP_FILE_SIZE_BYTES) {
            return {
              llmContent: `File too large for LSP analysis (${Math.ceil(stats.size / 1_000_000)}MB exceeds 10MB limit)`,
              returnDisplay: 'Error: File too large.',
            };
          }
          const fileContent = await handle.readFile({ encoding: 'utf-8' });
          await manager.openFile(absolutePath, fileContent);
        } finally {
          await handle.close();
        }
      }

      let result = await manager.sendRequest(absolutePath, method, params);

      if (result === undefined) {
        return {
          llmContent: `No LSP server available for file type: ${path.extname(absolutePath)}`,
          returnDisplay: 'Error: No LSP server.',
        };
      }

      if (
        input.operation === 'incomingCalls' ||
        input.operation === 'outgoingCalls'
      ) {
        const callItems = result as CallHierarchyItem[];
        if (!callItems || callItems.length === 0) {
          return {
            llmContent: 'No call hierarchy item found at this position',
            returnDisplay: 'No items found.',
          };
        }

        const callMethod =
          input.operation === 'incomingCalls'
            ? 'callHierarchy/incomingCalls'
            : 'callHierarchy/outgoingCalls';

        result = await manager.sendRequest(absolutePath, callMethod, {
          item: callItems[0],
        });
      }

      // Filter out gitignored files
      if (
        result &&
        Array.isArray(result) &&
        (input.operation === 'findReferences' ||
          input.operation === 'goToDefinition' ||
          input.operation === 'goToImplementation' ||
          input.operation === 'workspaceSymbol')
      ) {
        const fileDiscoveryService = this.config.getFileService();
        if (input.operation === 'workspaceSymbol') {
          const symbols = result as SymbolInformation[];
          const filteredSymbols = [];
          for (const sym of symbols) {
            if (sym?.location?.uri) {
              const filePath = uriToFilePath(sym.location.uri);
              if (!fileDiscoveryService.shouldIgnoreFile(filePath)) {
                filteredSymbols.push(sym);
              }
            }
          }
          result = filteredSymbols;
        } else {
          const locations = result as (Location | LocationLink)[];
          const filteredLocations = [];
          for (const loc of locations) {
            const location = toLocation(loc);
            if (location.uri) {
              const filePath = uriToFilePath(location.uri);
              if (!fileDiscoveryService.shouldIgnoreFile(filePath)) {
                filteredLocations.push(loc);
              }
            }
          }
          result = filteredLocations;
        }
      }

      const formatted = formatResult(input.operation, result, cwd);

      return {
        llmContent: formatted,
        returnDisplay: 'LSP query completed.',
      };
    } catch (error) {
      debugLogger.error(
        new Error(
          `LSP tool request failed for ${input.operation} on ${input.filePath}: ${errorMessage(error)}`,
        ),
      );
      return {
        llmContent: `Error performing ${input.operation}: ${errorMessage(error)}`,
        returnDisplay: 'Error performing LSP query.',
      };
    }
  }

  getDescription(): string {
    return `LSP ${this.params.operation} on ${this.params.filePath}`;
  }

  override toolLocations(): ToolLocation[] {
    return [
      {
        path: path.resolve(this.config.getTargetDir(), this.params.filePath),
        line: this.params.line,
      },
    ];
  }
}

export class LSPQueryTool extends BaseDeclarativeTool<
  LSPToolInput,
  ToolResult
> {
  static readonly Name = LSP_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      LSPQueryTool.Name,
      'LSP Query',
      DESCRIPTION,
      Kind.Read,
      lspToolInputSchema,
      messageBus,
    );
  }

  isEnabled(): boolean {
    return isLspConnected();
  }

  protected override validateToolParamValues(
    input: LSPToolInput,
  ): string | null {
    const absolutePath = path.resolve(
      this.config.getTargetDir(),
      input.filePath,
    );

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
      return null;
    }

    return this.config.validatePathAccess(absolutePath);
  }

  protected createInvocation(
    params: LSPToolInput,
    messageBus: MessageBus,
  ): ToolInvocation<LSPToolInput, ToolResult> {
    return new LSPQueryToolInvocation(
      this.config,
      params,
      messageBus,
      this.name,
      this.displayName,
    );
  }
}

function getMethodAndParams(
  input: LSPToolInput,
  absolutePath: string,
): { method: string; params: unknown } {
  const uri = pathToFileURL(absolutePath).href;
  const position = {
    line: input.line - 1,
    character: input.character - 1,
  };

  switch (input.operation) {
    case 'goToDefinition':
      return {
        method: 'textDocument/definition',
        params: {
          textDocument: { uri },
          position,
        },
      };
    case 'findReferences':
      return {
        method: 'textDocument/references',
        params: {
          textDocument: { uri },
          position,
          context: { includeDeclaration: true },
        },
      };
    case 'hover':
      return {
        method: 'textDocument/hover',
        params: {
          textDocument: { uri },
          position,
        },
      };
    case 'documentSymbol':
      return {
        method: 'textDocument/documentSymbol',
        params: {
          textDocument: { uri },
        },
      };
    case 'workspaceSymbol':
      return {
        method: 'workspace/symbol',
        params: {
          query: '',
        },
      };
    case 'goToImplementation':
      return {
        method: 'textDocument/implementation',
        params: {
          textDocument: { uri },
          position,
        },
      };
    case 'prepareCallHierarchy':
    case 'incomingCalls':
    case 'outgoingCalls':
      return {
        method: 'textDocument/prepareCallHierarchy',
        params: {
          textDocument: { uri },
          position,
        },
      };
    default:
      // Should never happen due to discriminated union
      throw new Error(`Unsupported LSP operation: ${(input as any).operation}`);
  }
}

function uriToFilePath(uri: string): string {
  let filePath = uri.replace(/^file:\/\//, '');
  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    // ignore
  }
  return filePath;
}

function isLocationLink(item: Location | LocationLink): item is LocationLink {
  return 'targetUri' in item;
}

function toLocation(item: Location | LocationLink): Location {
  if (isLocationLink(item)) {
    return {
      uri: item.targetUri,
      range: item.targetSelectionRange || item.targetRange,
    };
  }
  return item;
}

function formatResult(
  operation: LSPToolInput['operation'],
  result: unknown,
  cwd: string,
): string {
  switch (operation) {
    case 'goToDefinition':
    case 'goToImplementation':
      return formatGoToDefinitionResult(
        result as Location | Location[] | LocationLink | LocationLink[] | null,
        cwd,
      );
    case 'findReferences':
      return formatFindReferencesResult(result as Location[] | null, cwd);
    case 'hover':
      return formatHoverResult(result as Hover | null, cwd);
    case 'documentSymbol':
      return formatDocumentSymbolResult(
        result as (DocumentSymbol[] | SymbolInformation[]) | null,
        cwd,
      );
    case 'workspaceSymbol':
      return formatWorkspaceSymbolResult(
        result as SymbolInformation[] | null,
        cwd,
      );
    case 'prepareCallHierarchy':
      return formatPrepareCallHierarchyResult(
        result as CallHierarchyItem[] | null,
        cwd,
      );
    case 'incomingCalls':
      return formatIncomingCallsResult(
        result as CallHierarchyIncomingCall[] | null,
        cwd,
      );
    case 'outgoingCalls':
      return formatOutgoingCallsResult(
        result as CallHierarchyOutgoingCall[] | null,
        cwd,
      );
    default:
      throw new Error(`Unsupported LSP operation: ${operation}`);
  }
}
