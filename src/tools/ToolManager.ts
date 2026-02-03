/**
 * Tool Manager
 * 
 * Orchestrates tool detection, parsing, and execution.
 * Acts as the bridge between LLM responses and vault operations.
 */

import { App, Notice, Modal } from 'obsidian';
import { ToolExecutor } from './ToolExecutor';
import {
  ToolCall,
  ToolResult,
  parseToolCalls,
  removeToolBlocks,
  generateToolDescriptions,
  getToolByName,
  isDestructiveTool,
} from './definitions';

/**
 * Result of processing a response that may contain tool calls
 */
export interface ProcessedResponse {
  /** The response text with tool blocks removed */
  content: string;
  /** Tool calls that were detected */
  toolCalls: ToolCall[];
  /** Results of tool executions */
  toolResults: ToolResult[];
  /** Whether any tools were executed */
  hasToolCalls: boolean;
  /** Summary message of all tool actions */
  toolSummary: string;
}

/**
 * Configuration for tool execution
 */
export interface ToolManagerConfig {
  enabled: boolean;
  requireConfirmation: boolean;
  maxToolCallsPerResponse: number;
}

const DEFAULT_CONFIG: ToolManagerConfig = {
  enabled: true,
  requireConfirmation: false,
  maxToolCallsPerResponse: 10,
};

/**
 * Confirmation modal for destructive tool actions
 */
class ToolConfirmationModal extends Modal {
  private toolCall: ToolCall;
  private onConfirm: () => void;
  private onCancel: () => void;
  private resolved: boolean = false;

  constructor(
    app: App,
    toolCall: ToolCall,
    onConfirm: () => void,
    onCancel: () => void
  ) {
    super(app);
    this.toolCall = toolCall;
    this.onConfirm = onConfirm;
    this.onCancel = onCancel;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('calcifer-confirmation-modal');

    contentEl.createEl('h2', { text: '⚠️ Confirm Action' });

    contentEl.createEl('p', {
      text: `Calcifer wants to execute a ${isDestructiveTool(this.toolCall.name) ? 'destructive' : 'modifying'} action:`,
    });

    const detailsEl = contentEl.createDiv({ cls: 'calcifer-tool-details' });
    detailsEl.createEl('strong', { text: `Tool: ${this.toolCall.name}` });

    const argsEl = detailsEl.createEl('pre');
    argsEl.setText(JSON.stringify(this.toolCall.arguments, null, 2));

    if (isDestructiveTool(this.toolCall.name)) {
      contentEl.createEl('p', {
        text: '⚠️ This action may delete data permanently!',
        cls: 'calcifer-warning',
      });
    }

    const buttonContainer = contentEl.createDiv({ cls: 'calcifer-modal-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => {
      this.resolved = true;
      this.onCancel();
      this.close();
    });

    const confirmBtn = buttonContainer.createEl('button', {
      text: 'Confirm',
      cls: 'mod-warning',
    });
    confirmBtn.addEventListener('click', () => {
      this.resolved = true;
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();

    // If modal was closed without clicking a button (ESC, click outside, etc.),
    // treat it as cancellation to prevent hanging promise
    if (!this.resolved) {
      this.onCancel();
    }
  }
}

/**
 * Manages tool detection and execution
 */
export class ToolManager {
  private app: App;
  private executor: ToolExecutor;
  private config: ToolManagerConfig;

  constructor(app: App, config: Partial<ToolManagerConfig> = {}) {
    this.app = app;
    this.executor = new ToolExecutor(app);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ToolManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable or disable tool execution
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Set whether confirmation is required for destructive tools
   */
  setRequireConfirmation(require: boolean): void {
    this.config.requireConfirmation = require;
  }

  /**
   * Check if tool execution is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the tool descriptions for the system prompt
   */
  getToolDescriptions(): string {
    return generateToolDescriptions();
  }

  /**
   * Process an LLM response, detecting and executing any tool calls
   */
  async processResponse(response: string): Promise<ProcessedResponse> {
    // Parse tool calls from the response
    const toolCalls = parseToolCalls(response);
    
    if (toolCalls.length === 0 || !this.config.enabled) {
      return {
        content: response,
        toolCalls: [],
        toolResults: [],
        hasToolCalls: false,
        toolSummary: '',
      };
    }
    
    // Rate limiting: prevent runaway tool execution
    if (toolCalls.length > this.config.maxToolCallsPerResponse) {
      console.warn(`[Calcifer] Too many tool calls (${toolCalls.length}), limiting to ${this.config.maxToolCallsPerResponse}`);
      toolCalls.splice(this.config.maxToolCallsPerResponse);
    }
    
    // Remove tool blocks from the display content
    const cleanContent = removeToolBlocks(response);
    
    // Execute each tool call
    const toolResults: ToolResult[] = [];
    const summaryParts: string[] = [];
    
    for (const toolCall of toolCalls) {
      
      // Validate tool exists
      const tool = getToolByName(toolCall.name);
      if (!tool) {
        const result: ToolResult = {
          success: false,
          message: `Unknown tool: ${toolCall.name}`,
        };
        toolResults.push(result);
        summaryParts.push(`❌ ${toolCall.name}: Unknown tool`);
        continue;
      }
      
      // Check if confirmation is required for this tool
      if (this.config.requireConfirmation && isDestructiveTool(toolCall.name)) {
        const confirmed = await this.requestConfirmation(toolCall);
        if (!confirmed) {
          const result: ToolResult = {
            success: false,
            message: `${toolCall.name}: Cancelled by user`,
          };
          toolResults.push(result);
          summaryParts.push(`⏹️ ${toolCall.name}: Cancelled by user`);
          continue;
        }
      }
      
      // Execute the tool
      const result = await this.executor.execute(toolCall);
      toolResults.push(result);

      // Build summary
      const icon = result.success ? '✅' : '❌';
      summaryParts.push(`${icon} ${result.message}`);
      
      // Show notification for the action
      if (result.success) {
        new Notice(`Calcifer: ${result.message}`, 3000);
      } else {
        new Notice(`Calcifer Error: ${result.message}`, 5000);
      }
    }
    
    return {
      content: cleanContent,
      toolCalls,
      toolResults,
      hasToolCalls: true,
      toolSummary: summaryParts.join('\n'),
    };
  }

  /**
   * Request user confirmation for a tool call
   */
  private requestConfirmation(toolCall: ToolCall): Promise<boolean> {
    return new Promise((resolve) => {
      new ToolConfirmationModal(
        this.app,
        toolCall,
        () => resolve(true),
        () => resolve(false)
      ).open();
    });
  }

  /**
   * Execute a single tool call directly (for manual invocation)
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.executor.execute({ name, arguments: args });
  }

  /**
   * Check if a response contains tool calls without executing them
   */
  hasToolCalls(response: string): boolean {
    const calls = parseToolCalls(response);
    return calls.length > 0;
  }

  /**
   * Get tool calls from a response without executing them
   */
  getToolCalls(response: string): ToolCall[] {
    return parseToolCalls(response);
  }

  /**
   * Get a clean version of the response without tool blocks
   */
  getCleanResponse(response: string): string {
    return removeToolBlocks(response);
  }
}
