/**
 * Calcifer - AI-powered assistant for Obsidian
 * 
 * Features:
 * - RAG/Embeddings for semantic vault understanding
 * - Chat interface with vault context
 * - Auto-tagging based on content patterns
 * - Note organization suggestions
 * - Persistent memory system
 */

import { Plugin, WorkspaceLeaf, Notice } from 'obsidian';
import { CalciferSettings, DEFAULT_SETTINGS } from '@/settings';
import { CalciferSettingsTab } from '@/views/SettingsTab';
import { ChatView, CHAT_VIEW_TYPE } from '@/views/ChatView';
import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore } from '@/vectorstore/VectorStore';
import { EmbeddingManager } from '@/embedding/EmbeddingManager';
import { RAGPipeline } from '@/rag/RAGPipeline';
import { MemoryManager } from '@/features/memory';
import { AutoTagger } from '@/features/autoTag';
import { NoteOrganizer } from '@/features/organize';

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
    
    console.log('Calcifer plugin loaded');
  }

  async onunload() {
    console.log('Unloading Calcifer plugin');
    
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
        this.settings
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
        new Notice('Calcifer: Starting vault indexing...');
        await this.embeddingManager.indexVault(true);
        new Notice('Calcifer: Vault indexing complete');
      },
    });
    
    // Clear index
    this.addCommand({
      id: 'clear-index',
      name: 'Clear Embedding Index',
      callback: async () => {
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
        // TODO: Open memory management modal
        new Notice(`Calcifer: ${this.memoryManager.getMemoryCount()} memories stored`);
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
    // Index new files
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file.path.endsWith('.md') && this.settings.enableEmbedding) {
          // Debounced indexing handled by EmbeddingManager
          this.embeddingManager.queueFile(file.path);
        }
      })
    );
    
    // Re-index modified files
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file.path.endsWith('.md') && this.settings.enableEmbedding) {
          this.embeddingManager.queueFile(file.path);
        }
        
        // Auto-tag if enabled
        if (this.settings.enableAutoTag && file.path.endsWith('.md')) {
          this.autoTagger.queueFile(file.path);
        }
      })
    );
    
    // Remove deleted files from index
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file.path.endsWith('.md')) {
          this.vectorStore.deleteByPath(file.path);
        }
      })
    );
    
    // Handle renamed files
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
   * Load plugin settings
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  /**
   * Save plugin settings
   */
  async saveSettings() {
    await this.saveData(this.settings);
    
    // Notify services of settings change
    this.providerManager?.updateSettings(this.settings);
    this.embeddingManager?.updateSettings(this.settings);
  }
}
