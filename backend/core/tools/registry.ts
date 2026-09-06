import { CoreError } from '../errors';
import { BUILTIN_TOOLS } from './builtin-tools';
import type { ToolDefinition } from './types';

/**
 * Explicit tool registry. Unknown tools/versions are rejected and never
 * dispatched; there is no lookup by arbitrary function name.
 */
export class ToolRegistry {
  private readonly byName = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = BUILTIN_TOOLS) {
    for (const tool of tools) this.register(tool);
  }

  register(tool: ToolDefinition): void {
    this.byName.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): ToolDefinition {
    const tool = this.byName.get(name);
    if (!tool) throw new CoreError('TOOL_UNKNOWN', `Unknown tool: ${name}`);
    return tool;
  }

  /** Returns the definition only when the requested version is supported. */
  resolve(name: string, version?: number): ToolDefinition {
    const tool = this.get(name);
    if (version !== undefined && tool.version !== version) {
      throw new CoreError('TOOL_UNKNOWN', `Unsupported tool version: ${name}@v${version}`);
    }
    return tool;
  }

  list(): ToolDefinition[] {
    return [...this.byName.values()];
  }
}
