/**
 * Memory Management Modal
 * 
 * Allows users to view, edit, and delete stored memories.
 */

import { App, Modal, Setting, Notice, TextAreaComponent } from 'obsidian';
import type { Memory } from '@/features/memory';
import type { MemoryManager } from '@/features/memory';

/**
 * Confirmation Dialog Modal
 */
class ConfirmationModal extends Modal {
  private message: string;
  private onConfirm: () => void;

  constructor(app: App, message: string, onConfirm: () => void) {
    super(app);
    this.message = message;
    this.onConfirm = onConfirm;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('calcifer-confirm-modal');

    contentEl.createEl('h3', { text: 'Confirm' });
    contentEl.createEl('p', { text: this.message });

    const buttonContainer = contentEl.createDiv({ cls: 'calcifer-confirm-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const confirmBtn = buttonContainer.createEl('button', { 
      text: 'Confirm',
      cls: 'mod-warning'
    });
    confirmBtn.addEventListener('click', () => {
      this.onConfirm();
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * Memory Management Modal
 */
export class MemoryModal extends Modal {
  private memoryManager: MemoryManager;
  private listContainer: HTMLElement | null = null;

  constructor(app: App, memoryManager: MemoryManager) {
    super(app);
    this.memoryManager = memoryManager;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('calcifer-memory-modal');

    // Header
    contentEl.createEl('h2', { text: 'Calcifer Memories' });
    contentEl.createEl('p', {
      text: 'These are facts and preferences Calcifer has learned from your conversations.',
      cls: 'calcifer-memory-description'
    });

    // Actions bar
    const actionsBar = contentEl.createDiv({ cls: 'calcifer-memory-actions' });
    
    // Add new memory button
    new Setting(actionsBar)
      .setName('Add Memory')
      .addButton(button => button
        .setButtonText('+ Add')
        .onClick(() => this.showAddMemoryDialog())
      );

    // Clear all button
    new Setting(actionsBar)
      .setName('Clear All')
      .addButton(button => button
        .setButtonText('Clear All')
        .setWarning()
        .onClick(() => {
          new ConfirmationModal(
            this.app,
            'Are you sure you want to delete all memories? This cannot be undone.',
            async () => {
              await this.memoryManager.clearAllMemories();
              this.renderMemories();
              new Notice('All memories cleared');
            }
          ).open();
        })
      );

    // Memory list container
    this.listContainer = contentEl.createDiv({ cls: 'calcifer-memory-list' });
    this.renderMemories();

    // Stats
    const stats = contentEl.createDiv({ cls: 'calcifer-memory-stats' });
    this.updateStats(stats);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }

  /**
   * Render the list of memories
   */
  private renderMemories(): void {
    if (!this.listContainer) return;
    this.listContainer.empty();

    const memories = this.memoryManager.getAllMemories();

    if (memories.length === 0) {
      this.listContainer.createEl('p', {
        text: 'No memories stored yet. Calcifer will learn from your conversations.',
        cls: 'calcifer-memory-empty'
      });
      return;
    }

    for (const memory of memories) {
      this.renderMemoryItem(this.listContainer, memory);
    }
  }

  /**
   * Render a single memory item
   */
  private renderMemoryItem(container: HTMLElement, memory: Memory): void {
    const item = container.createDiv({ cls: 'calcifer-memory-item' });

    // Content
    const contentDiv = item.createDiv({ cls: 'calcifer-memory-content' });
    contentDiv.createSpan({ text: memory.content });

    // Metadata
    const metaDiv = item.createDiv({ cls: 'calcifer-memory-meta' });
    const createdDate = new Date(memory.createdAt);
    metaDiv.createSpan({
      text: `Created: ${createdDate.toLocaleDateString()} • Accessed: ${memory.accessCount} times`,
      cls: 'calcifer-memory-date'
    });

    if (memory.source) {
      metaDiv.createSpan({
        text: ` • Source: ${memory.source}`,
        cls: 'calcifer-memory-source'
      });
    }

    // Actions
    const actions = item.createDiv({ cls: 'calcifer-memory-item-actions' });

    // Edit button
    const editBtn = actions.createEl('button', { cls: 'calcifer-memory-btn' });
    editBtn.setText('Edit');
    editBtn.addEventListener('click', () => this.showEditMemoryDialog(memory));

    // Delete button
    const deleteBtn = actions.createEl('button', { cls: 'calcifer-memory-btn calcifer-memory-btn-danger' });
    deleteBtn.setText('Delete');
    deleteBtn.addEventListener('click', async () => {
      await this.memoryManager.deleteMemory(memory.id);
      this.renderMemories();
      new Notice('Memory deleted');
    });
  }

  /**
   * Show dialog to add a new memory
   */
  private showAddMemoryDialog(): void {
    const dialog = new AddEditMemoryModal(this.app, null, async (content) => {
      await this.memoryManager.addMemory(content, 'manual');
      this.renderMemories();
      new Notice('Memory added');
    });
    dialog.open();
  }

  /**
   * Show dialog to edit a memory
   */
  private showEditMemoryDialog(memory: Memory): void {
    const dialog = new AddEditMemoryModal(this.app, memory, async (content) => {
      await this.memoryManager.updateMemory(memory.id, content);
      this.renderMemories();
      new Notice('Memory updated');
    });
    dialog.open();
  }

  /**
   * Update stats display
   */
  private updateStats(container: HTMLElement): void {
    container.empty();
    const count = this.memoryManager.getMemoryCount();
    container.createSpan({
      text: `${count} memor${count === 1 ? 'y' : 'ies'} stored`,
      cls: 'calcifer-memory-stats-text'
    });
  }
}

/**
 * Modal for adding/editing a memory
 */
class AddEditMemoryModal extends Modal {
  private memory: Memory | null;
  private onSave: (content: string) => void;
  private textArea: TextAreaComponent | null = null;

  constructor(app: App, memory: Memory | null, onSave: (content: string) => void) {
    super(app);
    this.memory = memory;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.createEl('h3', { 
      text: this.memory ? 'Edit Memory' : 'Add Memory' 
    });

    // Text area for memory content
    new Setting(contentEl)
      .setName('Memory Content')
      .setDesc('A fact or preference to remember')
      .addTextArea(text => {
        this.textArea = text;
        text
          .setPlaceholder('e.g., User prefers concise answers')
          .setValue(this.memory?.content || '');
        text.inputEl.rows = 4;
        text.inputEl.addClass('calcifer-memory-textarea');
      });

    // Buttons
    const buttonContainer = contentEl.createDiv({ cls: 'calcifer-memory-dialog-buttons' });

    const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = buttonContainer.createEl('button', { 
      text: 'Save',
      cls: 'mod-cta'
    });
    saveBtn.addEventListener('click', () => {
      const content = this.textArea?.getValue().trim();
      if (content) {
        this.onSave(content);
        this.close();
      } else {
        new Notice('Memory content cannot be empty');
      }
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
