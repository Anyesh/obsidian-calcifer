/**
 * Calcifer - AI-powered assistant for Obsidian
 * 
 * Features:
 * - RAG/Embeddings for semantic vault understanding
 * - Chat interface with vault context
 * - Auto-tagging based on content patterns
 * - Note organization suggestions
 * - Persistent memory system
 * - Tool calling for vault operations
 */

import { Plugin, WorkspaceLeaf, Notice, setIcon } from 'obsidian';
import { CalciferSettings, DEFAULT_SETTINGS } from '@/settings';
import { CalciferSettingsTab } from '@/views/SettingsTab';
import { ChatView, CHAT_VIEW_TYPE } from '@/views/ChatView';
import { MemoryModal } from '@/views/MemoryModal';
import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore } from '@/vectorstore/VectorStore';
import { EmbeddingManager, IndexingProgress } from '@/embedding/EmbeddingManager';
import { RAGPipeline } from '@/rag/RAGPipeline';
import { MemoryManager } from '@/features/memory';
import { AutoTagger } from '@/features/autoTag';
import { NoteOrganizer } from '@/features/organize';
import { ToolManager } from '@/tools';

export default class CalciferPlugin extends Plugin {
  settings: CalciferSettings;
  
  // Core services
  providerManager: ProviderManager;
  vectorStore: VectorStore;
  embeddingManager: EmbeddingManager;
  ragPipeline: RAGPipeline;
  memoryManager: MemoryManager;
  autoTagger: AutoTagger;
  noteOrganizer: NoteOrganizer;
  toolManager: ToolManager;
  
  // Status bar
  private statusBarItem: HTMLElement | null = null;

  async onload() {
    console.log('Loading Calcifer plugin');
    
    // Load settings
    await this.loadSettings();
    
    // Initialize core services
    await this.initializeServices();
    
    // Register views
    this.registerView(
      CHAT_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this)
    );
    
    // Add settings tab
    this.addSettingTab(new CalciferSettingsTab(this.app, this));
    
    // Add ribbon icon
    this.addRibbonIcon('bot', 'Open Calcifer Chat', () => {
      this.activateChatView();
    });
    
    // Register commands
    this.registerCommands();
    
    // Register event handlers
    this.registerEventHandlers();
    
    // Add status bar item
    this.setupStatusBar();
    
    console.log('Calcifer plugin loaded');
  }

  async onunload() {
    console.log('Unloading Calcifer plugin');
    
    // Force stop any running embedding
    this.embeddingManager?.forceStop();
    
    // Cleanup services
    this.embeddingManager?.cleanup();
    this.vectorStore?.close();
  }

  /**
   * Initialize all core services
   */
  async initializeServices() {
    try {
      // Provider manager handles API connections
      this.providerManager = new ProviderManager(this.settings);
      
      // Vector store for embeddings (IndexedDB)
      this.vectorStore = new VectorStore(this.app);
      await this.vectorStore.initialize();
      
      // Embedding manager orchestrates indexing
      this.embeddingManager = new EmbeddingManager(
        this.app,
        this.providerManager,
        this.vectorStore,
        this.settings,
        this
      );
      
      // Memory manager for persistent context
      this.memoryManager = new MemoryManager(this);
      await this.memoryManager.load();
      
      // RAG pipeline for chat with context
      this.ragPipeline = new RAGPipeline(
        this.providerManager,
        this.vectorStore,
        this.memoryManager,
        this.settings
      );
      
      // Tool manager for vault operations
      this.toolManager = new ToolManager(this.app, {
        enabled: this.settings.enableToolCalling,
        requireConfirmation: this.settings.requireToolConfirmation,
        maxToolCallsPerResponse: 10,
      });
      
      // Connect tool manager to RAG pipeline
      this.ragPipeline.setToolManager(this.toolManager);
      
      // Auto-tagging feature
      this.autoTagger = new AutoTagger(
        this.app,
        this.providerManager,
        this.vectorStore,
        this.settings
      );
      
      // Note organization feature
      this.noteOrganizer = new NoteOrganizer(
        this.app,
        this.providerManager,
        this.vectorStore,
        this.settings
      );
      
    } catch (error) {
      console.error('Failed to initialize Calcifer services:', error);
      new Notice('Calcifer: Failed to initialize. Check console for details.');
    }
  }

  /**
   * Register plugin commands
   */
  registerCommands() {
    // Open chat view
    this.addCommand({
      id: 'open-chat',
      name: 'Open Calcifer Chat',
      callback: () => this.activateChatView(),
    });
    
    // Re-index vault
    this.addCommand({
      id: 'reindex-vault',
      name: 'Re-index Vault',
      callback: async () => {
        if (!this.providerManager.hasAvailableProvider()) {
          new Notice('Calcifer: No provider configured. Add an endpoint first.');
          return;
        }
        if (!this.settings.enableEmbedding) {
          new Notice('Calcifer: Embedding is disabled. Enable it in settings first.');
          return;
        }
        new Notice('Calcifer: Starting vault indexing...');
        await this.embeddingManager.indexVault(true);
      },
    });
    
    // Stop indexing
    this.addCommand({
      id: 'stop-indexing',
      name: 'Stop Indexing (Emergency)',
      callback: () => {
        this.embeddingManager.forceStop();
        new Notice('Calcifer: Indexing stopped');
      },
    });
    
    // Clear index
    this.addCommand({
      id: 'clear-index',
      name: 'Clear Embedding Index',
      callback: async () => {
        this.embeddingManager.forceStop();
        await this.vectorStore.clear();
        new Notice('Calcifer: Embedding index cleared');
      },
    });
    
    // Index current file
    this.addCommand({
      id: 'index-current-file',
      name: 'Index Current File',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            this.embeddingManager.indexFile(file);
            new Notice(`Calcifer: Indexing ${file.basename}`);
          }
          return true;
        }
        return false;
      },
    });
    
    // Show memories
    this.addCommand({
      id: 'show-memories',
      name: 'Show Memories',
      callback: () => {
        new MemoryModal(this.app, this.memoryManager).open();
      },
    });
    
    // Show status
    this.addCommand({
      id: 'show-status',
      name: 'Show Status',
      callback: async () => {
        const stats = await this.vectorStore.getStats();
        const healthResults = await this.providerManager.checkAllHealth();
        
        let healthyCount = 0;
        healthResults.forEach((result) => {
          if (result.healthy) healthyCount++;
        });
        
        const statusMsg = [
          `📊 Calcifer Status`,
          ``,
          `📁 Indexed Files: ${stats.uniqueFiles}`,
          `🧩 Total Chunks: ${stats.totalChunks}`,
          `🔌 Providers: ${healthyCount}/${healthResults.size} healthy`,
          `🧠 Memories: ${this.memoryManager.getMemoryCount()}`,
        ];
        
        if (this.embeddingManager.isIndexingActive()) {
          const progress = this.embeddingManager.getProgress();
          if (progress) {
            statusMsg.push(``, `⏳ Indexing: ${progress.completed}/${progress.total} files`);
          }
        }
        
        new Notice(statusMsg.join('\n'), 8000);
      },
    });
    
    // Suggest tags for current file
    this.addCommand({
      id: 'suggest-tags',
      name: 'Suggest Tags for Current Note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            this.autoTagger.suggestTags(file);
          }
          return true;
        }
        return false;
      },
    });
    
    // Suggest folder for current file
    this.addCommand({
      id: 'suggest-folder',
      name: 'Suggest Folder for Current Note',
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file && file.extension === 'md') {
          if (!checking) {
            this.noteOrganizer.suggestFolder(file);
          }
          return true;
        }
        return false;
      },
    });
  }

  /**
   * Register event handlers for file changes
   */
  registerEventHandlers() {
    // Handle file modifications for auto-tagging (this is lightweight)
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file.path.endsWith('.md')) {
          // Queue for auto-tagging (debounced internally)
          if (this.settings.enableAutoTag && this.autoTagger) {
            this.autoTagger.queueFile(file.path);
          }
        }
      })
    );
    
    // Remove deleted files from index (this is safe, just deletes)
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file.path.endsWith('.md')) {
          this.vectorStore.deleteByPath(file.path);
        }
      })
    );
    
    // Handle renamed files (this is safe, just updates path)
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file.path.endsWith('.md')) {
          this.vectorStore.updatePath(oldPath, file.path);
        }
      })
    );
  }

  /**
   * Activate or create the chat view
   */
  async activateChatView() {
    const { workspace } = this.app;
    
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    
    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new leaf in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      }
    }
    
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Setup status bar item
   */
  private setupStatusBar() {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass('calcifer-status');
    this.updateStatusBar('idle');
    
    // Make status bar clickable to open chat
    this.statusBarItem.onClickEvent(() => {
      this.activateChatView();
    });
    
    // Subscribe to embedding progress
    this.embeddingManager.onProgress((progress) => {
      this.updateStatusBar('indexing', progress);
    });
  }

  /**
   * Update status bar display
   */
  private updateStatusBar(
    status: 'idle' | 'indexing' | 'chatting' | 'error',
    progress?: IndexingProgress
  ) {
    if (!this.statusBarItem) return;
    
    this.statusBarItem.empty();
    
    const icon = this.statusBarItem.createSpan({ cls: 'calcifer-status-icon' });
    const text = this.statusBarItem.createSpan({ cls: 'calcifer-status-text' });
    
    switch (status) {
      case 'idle':
        setIcon(icon, 'bot');
        text.setText('Calcifer');
        this.statusBarItem.removeClass('calcifer-status-busy', 'calcifer-status-error');
        break;
        
      case 'indexing':
        setIcon(icon, 'loader-2');
        icon.addClass('calcifer-spin');
        if (progress) {
          const pct = Math.round((progress.completed / progress.total) * 100);
          text.setText(`Indexing: ${pct}% (${progress.completed}/${progress.total})`);
          if (progress.errors > 0) {
            text.setText(`${text.getText()} ⚠${progress.errors}`);
          }
        } else {
          text.setText('Indexing...');
        }
        this.statusBarItem.addClass('calcifer-status-busy');
        this.statusBarItem.removeClass('calcifer-status-error');
        break;
        
      case 'chatting':
        setIcon(icon, 'loader-2');
        icon.addClass('calcifer-spin');
        text.setText('Thinking...');
        this.statusBarItem.addClass('calcifer-status-busy');
        this.statusBarItem.removeClass('calcifer-status-error');
        break;
        
      case 'error':
        setIcon(icon, 'alert-circle');
        text.setText('Calcifer (Error)');
        this.statusBarItem.addClass('calcifer-status-error');
        this.statusBarItem.removeClass('calcifer-status-busy');
        break;
    }
  }

  /**
   * Set status to chatting (for external use)
   */
  setStatusChatting(active: boolean) {
    this.updateStatusBar(active ? 'chatting' : 'idle');
  }

  /**
   * Set status to error (for external use)
   */
  setStatusError() {
    this.updateStatusBar('error');
  }

  /**
   * Load plugin settings
   */
  async loadSettings() {
    const savedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
    
    // Migration: increase timeout if it was the old default of 30 seconds
    // First embedding request can take a long time as model loads into memory
    if (this.settings.requestTimeoutMs === 30000) {
      console.log('[Calcifer] Migrating requestTimeoutMs from 30s to 120s');
      this.settings.requestTimeoutMs = 120000;
      await this.saveData(this.settings);
    }
  }

  /**
   * Save plugin settings
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // Notify services of settings change
    this.providerManager?.updateSettings(this.settings);
    this.embeddingManager?.updateSettings(this.settings);
    this.ragPipeline?.updateSettings(this.settings);
    this.autoTagger?.updateSettings(this.settings);
    this.noteOrganizer?.updateSettings(this.settings);
    this.toolManager?.updateConfig({
      enabled: this.settings.enableToolCalling,
      requireConfirmation: this.settings.requireToolConfirmation,
    });
  }
}
