/**
 * Chat View
 * 
 * Main chat interface for Calcifer plugin.
 * Implements ItemView for Obsidian sidebar integration.
 */

import { ItemView, WorkspaceLeaf, setIcon, MarkdownRenderer, Notice } from 'obsidian';
import type CalciferPlugin from '@/../main';
import type { ChatMessage as ProviderMessage } from '@/providers/types';

export const CHAT_VIEW_TYPE = 'calcifer-chat-view';
const CHAT_HISTORY_KEY = 'calcifer-chat-history';
const MAX_PERSISTED_MESSAGES = 50;

/**
 * Serializable chat message for persistence
 */
interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  contextSources?: string[];
  isError?: boolean;
}

/**
 * Chat message for display
 */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  contextSources?: string[];
  isError?: boolean;
}

/**
 * Calcifer Chat View
 */
export class ChatView extends ItemView {
  private plugin: CalciferPlugin;
  private messages: ChatMessage[] = [];
  private isProcessing = false;
  
  // UI elements
  private messagesContainer: HTMLElement;
  private inputArea: HTMLTextAreaElement;
  private sendButton: HTMLButtonElement;
  private statusBar: HTMLElement;
  private contextPills: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: CalciferPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Calcifer Chat';
  }

  getIcon(): string {
    return 'bot';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('calcifer-chat-container');

    // Create UI structure
    this.createHeader(container as HTMLElement);
    this.createMessagesArea(container as HTMLElement);
    this.createInputArea(container as HTMLElement);
    this.createStatusBar(container as HTMLElement);

    // Load persisted messages or show welcome
    const loaded = await this.loadMessages();
    if (!loaded || this.messages.length === 0) {
      this.addSystemMessage(
        "Hello! I'm Calcifer, your AI assistant. I have access to your vault and can help you find information, organize notes, and more. What would you like to know?"
      );
    }
  }

  async onClose(): Promise<void> {
    // Save messages on close
    await this.saveMessages();
  }

  /**
   * Create the header section
   */
  private createHeader(container: HTMLElement): void {
    const header = container.createDiv({ cls: 'calcifer-header' });
    
    const title = header.createDiv({ cls: 'calcifer-header-title' });
    setIcon(title.createSpan(), 'bot');
    title.createSpan({ text: 'Calcifer' });

    // Actions
    const actions = header.createDiv({ cls: 'calcifer-header-actions' });
    
    // Clear chat button
    const clearBtn = actions.createEl('button', { cls: 'calcifer-action-btn' });
    setIcon(clearBtn, 'trash');
    clearBtn.title = 'Clear chat';
    clearBtn.addEventListener('click', () => this.clearChat());

    // Settings button
    const settingsBtn = actions.createEl('button', { cls: 'calcifer-action-btn' });
    setIcon(settingsBtn, 'settings');
    settingsBtn.title = 'Open settings';
    settingsBtn.addEventListener('click', () => {
      // Open settings tab - use internal command API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.app as any).commands?.executeCommandById('app:open-settings');
    });
  }

  /**
   * Create the messages display area
   */
  private createMessagesArea(container: HTMLElement): void {
    this.messagesContainer = container.createDiv({ cls: 'calcifer-messages' });
  }

  /**
   * Create the input area
   */
  private createInputArea(container: HTMLElement): void {
    const inputArea = container.createDiv({ cls: 'calcifer-input-area' });

    // Context pills (shows relevant notes when typing)
    this.contextPills = inputArea.createDiv({ cls: 'calcifer-context-pills' });

    // Input wrapper
    const inputWrapper = inputArea.createDiv({ cls: 'calcifer-input-wrapper' });

    // Text input
    this.inputArea = inputWrapper.createEl('textarea', {
      cls: 'calcifer-input',
      attr: {
        placeholder: 'Ask Calcifer anything about your vault...',
        rows: '3',
      },
    });

    // Handle Enter to send (Shift+Enter for newline)
    this.inputArea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Auto-resize textarea
    this.inputArea.addEventListener('input', () => {
      this.inputArea.setCssProps({
        '--input-height': 'auto',
      });
      this.inputArea.setCssProps({
        '--input-height': Math.min(this.inputArea.scrollHeight, 200) + 'px',
      });
    });

    // Send button
    this.sendButton = inputWrapper.createEl('button', {
      cls: 'calcifer-send-button',
      text: 'Send',
    });
    this.sendButton.addEventListener('click', () => this.sendMessage());
  }

  /**
   * Create the status bar
   */
  private createStatusBar(container: HTMLElement): void {
    this.statusBar = container.createDiv({ cls: 'calcifer-status-bar' });
    void this.updateStatus();
  }

  /**
   * Update status bar
   */
  private async updateStatus(): Promise<void> {
    this.statusBar.empty();

    const indicator = this.statusBar.createDiv({ cls: 'calcifer-status-indicator' });
    
    const hasProvider = this.plugin.providerManager?.hasAvailableProvider();
    const isIndexing = this.plugin.embeddingManager?.isIndexingActive();

    if (isIndexing) {
      indicator.createDiv({ cls: 'calcifer-status-dot calcifer-status-dot--indexing' });
      indicator.createSpan({ text: 'Indexing...' });
    } else if (hasProvider) {
      indicator.createDiv({ cls: 'calcifer-status-dot calcifer-status-dot--connected' });
      indicator.createSpan({ text: 'Connected' });
    } else {
      indicator.createDiv({ cls: 'calcifer-status-dot calcifer-status-dot--disconnected' });
      indicator.createSpan({ text: 'No provider configured' });
    }

    // Stats
    const stats = this.statusBar.createDiv({ cls: 'calcifer-status-stats' });
    const vectorStats = await this.plugin.vectorStore?.getStats();
    if (vectorStats) {
      stats.setText(`${vectorStats.uniqueFiles} files indexed`);
    }
  }

  /**
   * Send the current message
   */
  private async sendMessage(): Promise<void> {
    const content = this.inputArea.value.trim();
    if (!content || this.isProcessing) return;

    // Check if provider is available
    if (!this.plugin.providerManager?.hasAvailableProvider()) {
      new Notice('No AI provider configured. Please configure an endpoint in settings.');
      return;
    }

    // Add user message to chat
    this.addMessage('user', content);
    
    // Clear input
    this.inputArea.value = '';
    this.inputArea.setCssProps({ '--input-height': 'auto' });

    // Set processing state
    this.isProcessing = true;
    this.sendButton.disabled = true;
    this.sendButton.setText('...');
    this.plugin.setStatusChatting(true);

    // Show typing indicator
    const typingId = this.showTypingIndicator();

    try {
      // Get response from RAG pipeline
      const response = await this.plugin.ragPipeline.chat(
        content,
        this.getConversationHistory()
      );

      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Add assistant message
      this.addMessage('assistant', response.content, response.contextSources);

    } catch (error) {
      // Remove typing indicator
      this.removeTypingIndicator(typingId);

      // Show error
      console.error('Chat error:', error);
      this.addErrorMessage(
        `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      this.plugin.setStatusError();
    } finally {
      this.isProcessing = false;
      this.sendButton.disabled = false;
      this.sendButton.setText('Send');
      this.plugin.setStatusChatting(false);
    }
  }

  /**
   * Add a message to the chat
   */
  private addMessage(role: 'user' | 'assistant', content: string, contextSources?: string[]): void {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role,
      content,
      timestamp: new Date(),
      contextSources,
    };

    this.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();
    
    // Auto-save after each message
    this.saveMessages();
  }

  /**
   * Add a system message
   */
  private addSystemMessage(content: string): void {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: new Date(),
    };

    this.messages.push(message);
    this.renderMessage(message);
  }

  /**
   * Add an error message
   */
  private addErrorMessage(content: string): void {
    const message: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content,
      timestamp: new Date(),
      isError: true,
    };

    this.messages.push(message);
    this.renderMessage(message);
    this.scrollToBottom();
  }

  /**
   * Render a single message
   */
  private renderMessage(message: ChatMessage): void {
    const messageEl = this.messagesContainer.createDiv({
      cls: `calcifer-message calcifer-message--${message.role}${message.isError ? ' calcifer-message--error' : ''}`,
    });

    // Header
    const header = messageEl.createDiv({ cls: 'calcifer-message-header' });
    header.createSpan({
      cls: 'calcifer-message-role',
      text: message.role === 'user' ? 'You' : 'Calcifer',
    });
    header.createSpan({
      cls: 'calcifer-message-time',
      text: this.formatTime(message.timestamp),
    });

    // Content
    const contentEl = messageEl.createDiv({ cls: 'calcifer-message-content' });
    
    // Render markdown for assistant messages
    if (message.role === 'assistant') {
      MarkdownRenderer.render(
        this.app,
        message.content,
        contentEl,
        '',
        this
      );
    } else {
      contentEl.setText(message.content);
    }

    // Context sources
    if (message.contextSources && message.contextSources.length > 0 && this.plugin.settings.showContextSources) {
      const sourcesEl = messageEl.createDiv({ cls: 'calcifer-context-pills' });
      sourcesEl.createSpan({ cls: 'calcifer-context-label', text: 'Sources: ' });
      
      for (const source of message.contextSources) {
        const pill = sourcesEl.createSpan({ cls: 'calcifer-context-pill' });
        setIcon(pill.createSpan({ cls: 'calcifer-context-pill-icon' }), 'file-text');
        pill.createSpan({ text: this.getFileName(source) });
        
        // Click to open file
        pill.addEventListener('click', () => {
          const file = this.app.vault.getFileByPath(source);
          if (file) {
            this.app.workspace.openLinkText(source, '', false);
          }
        });
      }
    }
  }

  /**
   * Show typing indicator
   */
  private showTypingIndicator(): string {
    const id = `typing-${Date.now()}`;
    const typingEl = this.messagesContainer.createDiv({
      cls: 'calcifer-typing',
      attr: { 'data-typing-id': id },
    });
    
    const dots = typingEl.createDiv({ cls: 'calcifer-typing-dots' });
    dots.createDiv({ cls: 'calcifer-typing-dot' });
    dots.createDiv({ cls: 'calcifer-typing-dot' });
    dots.createDiv({ cls: 'calcifer-typing-dot' });
    
    typingEl.createSpan({ text: 'Calcifer is thinking...' });
    
    this.scrollToBottom();
    return id;
  }

  /**
   * Remove typing indicator
   */
  private removeTypingIndicator(id: string): void {
    const el = this.messagesContainer.querySelector(`[data-typing-id="${id}"]`);
    el?.remove();
  }

  /**
   * Get conversation history for context
   */
  private getConversationHistory(): ProviderMessage[] {
    if (!this.plugin.settings.includeChatHistory) {
      return [];
    }

    const maxMessages = this.plugin.settings.maxHistoryMessages;
    const recentMessages = this.messages.slice(-maxMessages);

    return recentMessages
      .filter(m => m.role !== 'system' && !m.isError)
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
  }

  /**
   * Clear the chat
   */
  private async clearChat(): Promise<void> {
    this.messages = [];
    this.messagesContainer.empty();
    await this.saveMessages();
    this.addSystemMessage(
      "Chat cleared. How can I help you?"
    );
  }

  /**
   * Save messages to plugin data
   */
  private async saveMessages(): Promise<void> {
    try {
      const data = await this.plugin.loadData() || {};
      
      // Convert to serializable format, limit count
      const toSave: PersistedMessage[] = this.messages
        .filter(m => !m.isError) // Don't persist error messages
        .slice(-MAX_PERSISTED_MESSAGES)
        .map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp.getTime(),
          contextSources: m.contextSources,
        }));
      
      data[CHAT_HISTORY_KEY] = toSave;
      await this.plugin.saveData(data);
    } catch (error) {
      console.error('[Calcifer] Failed to save chat history:', error);
    }
  }

  /**
   * Load messages from plugin data
   */
  private async loadMessages(): Promise<boolean> {
    try {
      const data = await this.plugin.loadData();
      const saved = data?.[CHAT_HISTORY_KEY] as PersistedMessage[] | undefined;
      
      if (!saved || !Array.isArray(saved) || saved.length === 0) {
        return false;
      }
      
      // Convert back to ChatMessage format
      this.messages = saved.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
        contextSources: m.contextSources,
        isError: m.isError,
      }));
      
      // Render all loaded messages
      for (const message of this.messages) {
        this.renderMessage(message);
      }
      
      this.scrollToBottom();
      return true;
    } catch (error) {
      console.error('[Calcifer] Failed to load chat history:', error);
      return false;
    }
  }

  /**
   * Scroll to the bottom of messages
   */
  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  /**
   * Format timestamp
   */
  private formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Get filename from path
   */
  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1].replace(/\.md$/, '');
  }
}
