/**
 * Tools Module
 * 
 * Exports all tool-related functionality for Calcifer.
 */

export { ToolManager } from './ToolManager';
export type { ProcessedResponse, ToolManagerConfig } from './ToolManager';
export { ToolExecutor } from './ToolExecutor';
export {
  TOOL_DEFINITIONS,
  getToolByName,
  generateToolDescriptions,
  parseToolCalls,
  removeToolBlocks,
  isDestructiveTool,
  isModifyingTool,
} from './definitions';
export type {
  ToolDefinition,
  ToolParameter,
  ToolCall,
  ToolResult,
} from './definitions';
