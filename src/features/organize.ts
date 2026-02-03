/**
 * Note Organizer
 * 
 * Suggests folder placement for notes based on content similarity.
 */

import { App, TFile, TFolder, Notice, Modal, Setting } from 'obsidian';
import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore, SearchResult } from '@/vectorstore/VectorStore';
import type { CalciferSettings } from '@/settings';

/**
 * Folder suggestion with reasoning
 */
export interface FolderSuggestion {
  path: string;
  confidence: number;
  reason: string;
  similarNotes: string[];
}

/**
 * Note Organizer
 */
export class NoteOrganizer {
  private app: App;
  private providerManager: ProviderManager;
  private vectorStore: VectorStore;
  private settings: CalciferSettings;

  constructor(
    app: App,
    providerManager: ProviderManager,
    vectorStore: VectorStore,
    settings: CalciferSettings
  ) {
    this.app = app;
    this.providerManager = providerManager;
    this.vectorStore = vectorStore;
    this.settings = settings;
  }

  /**
   * Update settings
   */
  updateSettings(settings: CalciferSettings): void {
    this.settings = settings;
  }

  /**
   * Suggest a folder for a file
   */
  async suggestFolder(file: TFile): Promise<void> {
    if (!this.settings.enableAutoOrganize) {
      new Notice('Auto-organization is disabled in settings');
      return;
    }
    
    new Notice('Analyzing note for folder suggestions...');
    
    try {
      const suggestions = await this.getSuggestions(file);
      
      if (suggestions.length === 0) {
        new Notice('No folder suggestions found');
        return;
      }
      
      if (this.settings.autoOrganizeMode === 'auto') {
        // Auto-move if high confidence
        const topSuggestion = suggestions[0];
        
        if (topSuggestion.confidence >= this.settings.autoOrganizeConfidence) {
          await this.moveFile(file, topSuggestion.path);
          new Notice(`Moved ${file.basename} to ${topSuggestion.path}`);
          return;
        }
      }
      
      // Show suggestions modal
      new FolderSuggestionModal(this.app, file, suggestions, this).open();
      
    } catch (error) {
      console.error('Folder suggestion failed:', error);
      new Notice('Failed to generate folder suggestions');
    }
  }

  /**
   * Get folder suggestions for a file
   */
  async getSuggestions(file: TFile): Promise<FolderSuggestion[]> {
    const content = await this.app.vault.cachedRead(file);
    
    // Find similar notes
    const similarNotes = await this.findSimilarNotes(file);
    
    // Analyze folder distribution of similar notes
    const folderCounts = new Map<string, { count: number; notes: string[] }>();
    
    for (const result of similarNotes) {
      const folder = this.getFolderPath(result.document.path);
      
      if (!folderCounts.has(folder)) {
        folderCounts.set(folder, { count: 0, notes: [] });
      }
      
      const entry = folderCounts.get(folder)!;
      entry.count++;
      entry.notes.push(result.document.path);
    }
    
    // Get all folders for additional options
    const allFolders = this.getAllFolders();
    
    // Build suggestions
    const suggestions: FolderSuggestion[] = [];
    
    // Add suggestions from similar notes
    for (const [folder, data] of folderCounts) {
      if (folder === this.getFolderPath(file.path)) continue; // Skip current folder
      
      const confidence = Math.min(data.count / similarNotes.length, 1);
      
      suggestions.push({
        path: folder,
        confidence,
        reason: `${data.count} similar notes found here`,
        similarNotes: data.notes.slice(0, 3),
      });
    }
    
    // Use LLM to suggest additional folders
    const llmSuggestions = await this.getLLMSuggestions(content, allFolders);
    
    for (const suggestion of llmSuggestions) {
      // Check if already suggested
      if (!suggestions.some(s => s.path === suggestion.path)) {
        suggestions.push(suggestion);
      }
    }
    
    // Sort by confidence
    suggestions.sort((a, b) => b.confidence - a.confidence);
    
    return suggestions.slice(0, 5);
  }

  /**
   * Find notes similar to the given file
   */
  private async findSimilarNotes(file: TFile): Promise<SearchResult[]> {
    try {
      // Get embeddings for the file
      const docs = await this.vectorStore.getByPath(file.path);
      
      if (docs.length === 0) {
        // File not indexed, generate embedding on the fly
        const content = await this.app.vault.cachedRead(file);
        const response = await this.providerManager.embed({
          input: content.slice(0, 2000),
          model: '',
        });
        
        if (response.embeddings.length === 0) return [];
        
        const results = await this.vectorStore.search(
          response.embeddings[0],
          20,
          0.5
        );
        
        return results.filter(r => r.document.path !== file.path);
      }
      
      // Average the embeddings
      const avgEmbedding = this.averageEmbeddings(docs.map(d => d.embedding));
      
      const results = await this.vectorStore.search(avgEmbedding, 20, 0.5);
      
      return results.filter(r => r.document.path !== file.path);
      
    } catch (error) {
      console.error('Failed to find similar notes:', error);
      return [];
    }
  }

  /**
   * Get folder suggestions from LLM
   */
  private async getLLMSuggestions(
    content: string,
    folders: string[]
  ): Promise<FolderSuggestion[]> {
    if (folders.length === 0) return [];
    
    try {
      const prompt = `Given this note content and the available folders, suggest the best folder for this note.

Note Content:
${content.slice(0, 1500)}

Available Folders:
${folders.slice(0, 30).join('\n')}

Return a JSON array with up to 3 suggestions:
[{"path": "folder/path", "confidence": 0.8, "reason": "explanation"}]`;

      const response = await this.providerManager.chat({
        messages: [
          {
            role: 'system',
            content: 'You are a note organization assistant. Suggest appropriate folders for notes. Return only valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 300,
      });
      
      const match = response.content.match(/\[[\s\S]*\]/);
      if (!match) return [];
      
      const suggestions = JSON.parse(match[0]) as FolderSuggestion[];
      
      // Validate paths exist
      return suggestions.filter(s => folders.includes(s.path));
      
    } catch (error) {
      console.error('LLM folder suggestion failed:', error);
      return [];
    }
  }

  /**
   * Move a file to a new folder
   */
  async moveFile(file: TFile, folderPath: string): Promise<void> {
    // Ensure folder exists
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      await this.app.vault.createFolder(folderPath);
    }
    
    // Move file
    const newPath = `${folderPath}/${file.name}`;
    await this.app.fileManager.renameFile(file, newPath);
  }

  /**
   * Get all folders in the vault
   */
  private getAllFolders(): string[] {
    const folders: string[] = [];
    
    const addFolders = (folder: TFolder, prefix: string = '') => {
      const path = prefix ? `${prefix}/${folder.name}` : folder.name;
      folders.push(path);
      
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          addFolders(child, path);
        }
      }
    };
    
    const root = this.app.vault.getRoot();
    for (const child of root.children) {
      if (child instanceof TFolder) {
        addFolders(child);
      }
    }
    
    return folders;
  }

  /**
   * Get folder path from file path
   */
  private getFolderPath(filePath: string): string {
    const lastSlash = filePath.lastIndexOf('/');
    return lastSlash > 0 ? filePath.slice(0, lastSlash) : '';
  }

  /**
   * Average multiple embeddings
   */
  private averageEmbeddings(embeddings: number[][]): number[] {
    if (embeddings.length === 0) return [];
    if (embeddings.length === 1) return embeddings[0];
    
    const dim = embeddings[0].length;
    const result: number[] = new Array<number>(dim).fill(0);
    
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        result[i] += emb[i];
      }
    }
    
    for (let i = 0; i < dim; i++) {
      result[i] /= embeddings.length;
    }
    
    return result;
  }
}

/**
 * Modal for folder suggestions
 */
class FolderSuggestionModal extends Modal {
  private file: TFile;
  private suggestions: FolderSuggestion[];
  private organizer: NoteOrganizer;

  constructor(
    app: App,
    file: TFile,
    suggestions: FolderSuggestion[],
    organizer: NoteOrganizer
  ) {
    super(app);
    this.file = file;
    this.suggestions = suggestions;
    this.organizer = organizer;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('calcifer-folder-modal');

    contentEl.createEl('h2', { text: `Move "${this.file.basename}"` });
    contentEl.createEl('p', { 
      text: 'Select a folder to move this note to:',
      cls: 'calcifer-folder-modal-desc'
    });

    const suggestionsEl = contentEl.createDiv({ cls: 'calcifer-folder-suggestions' });

    for (const suggestion of this.suggestions) {
      const item = suggestionsEl.createDiv({ cls: 'calcifer-folder-suggestion' });
      
      const pathEl = item.createDiv({ cls: 'calcifer-folder-path' });
      pathEl.createSpan({ text: `📁 ${suggestion.path}` });
      pathEl.createSpan({ 
        cls: 'calcifer-folder-confidence',
        text: `${Math.round(suggestion.confidence * 100)}%`
      });
      
      item.createDiv({ 
        cls: 'calcifer-folder-reason',
        text: suggestion.reason
      });
      
      item.addEventListener('click', () => {
        void (async () => {
          await this.organizer.moveFile(this.file, suggestion.path);
          new Notice(`Moved ${this.file.basename} to ${suggestion.path}`);
          this.close();
        })();
      });
    }

    // Cancel button
    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Cancel')
        .onClick(() => this.close())
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
