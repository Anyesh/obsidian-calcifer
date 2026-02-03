/**
 * Auto-Tagger
 * 
 * Suggests or automatically applies tags to notes based on content.
 */

import { App, TFile, Notice, Modal, Setting } from 'obsidian';
import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore } from '@/vectorstore/VectorStore';
import type { CalciferSettings } from '@/settings';
import { debounce } from '@/utils/debounce';

/**
 * Tag suggestion with confidence
 */
export interface TagSuggestion {
  tag: string;
  confidence: number;
  reason?: string;
}

/**
 * Auto-Tagger
 */
export class AutoTagger {
  private app: App;
  private providerManager: ProviderManager;
  private vectorStore: VectorStore;
  private settings: CalciferSettings;
  
  // Queue for files to tag
  private tagQueue: Set<string> = new Set();
  private processQueue: () => void;
  private isProcessing = false;
  
  // Circuit breaker
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 3;
  private circuitBroken = false;

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
    
    // Debounced queue processor
    this.processQueue = debounce(() => {
      this.processTagQueue();
    }, 5000); // Wait 5 seconds before processing
  }

  /**
   * Queue a file for tagging (only for truly new files without existing tags)
   */
  queueFile(path: string): void {
    if (!this.settings.enableAutoTag) return;
    if (this.circuitBroken) return;
    
    // Only queue in 'auto' mode - 'suggest' mode requires manual invocation
    if (this.settings.autoTagMode !== 'auto') return;
    
    // Check if file already has tags (skip if it does - not a truly new file)
    const file = this.app.vault.getFileByPath(path);
    if (file instanceof TFile) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter?.tags || (cache?.tags && cache.tags.length > 0)) {
        // File already has tags, skip auto-tagging
        return;
      }
    }
    
    this.tagQueue.add(path);
    this.processQueue();
  }
  
  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBroken = false;
    this.consecutiveErrors = 0;
  }

  /**
   * Update settings
   */
  updateSettings(settings: CalciferSettings): void {
    this.settings = settings;
    // Reset circuit breaker when settings change
    this.resetCircuitBreaker();
  }

  /**
   * Show tag suggestions modal for a file (manual invocation)
   */
  async showTagSuggestions(file: TFile): Promise<void> {
    new Notice('Analyzing note for tag suggestions...');
    
    try {
      const suggestions = await this.suggestTags(file);
      
      if (suggestions.length === 0) {
        new Notice('No tag suggestions found');
        return;
      }
      
      if (this.settings.autoTagMode === 'auto') {
        // Auto-apply high-confidence tags
        const highConfidence = suggestions
          .filter(s => s.confidence >= this.settings.autoTagConfidence)
          .map(s => s.tag);
        
        if (highConfidence.length > 0) {
          await this.applyTags(file, highConfidence);
          new Notice(`Added tags: ${highConfidence.join(', ')}`);
        } else {
          new Notice('No tags met the confidence threshold');
        }
      } else {
        // Show tag suggestion modal
        new TagSuggestionModal(this.app, file, suggestions, this).open();
      }
    } catch (error) {
      console.error('Tag suggestion failed:', error);
      new Notice('Failed to generate tag suggestions');
    }
  }

  /**
   * Suggest tags for a file (returns suggestions, no UI)
   */
  async suggestTags(file: TFile): Promise<TagSuggestion[]> {
    const content = await this.app.vault.cachedRead(file);
    
    // Get existing tags in vault
    const existingTags = this.settings.useExistingTags 
      ? this.getVaultTags()
      : [];
    
    // Build prompt
    const prompt = this.buildTagPrompt(content, existingTags);
    
    try {
      const response = await this.providerManager.chat({
        messages: [
          {
            role: 'system',
            content: `You are a note tagging assistant. Your job is to suggest descriptive tags for organizing notes in a personal knowledge base.

Rules:
- Tags should describe the SUBJECT MATTER of the note (e.g., "anime", "cooking", "python", "meeting-notes")
- Do NOT suggest meta-tags about the task (like "suggestion", "recommendation", "ideas")
- Tags should be lowercase with hyphens for spaces
- Return ONLY a valid JSON array, no other text

Example output: [{"tag": "anime", "confidence": 0.95}, {"tag": "comedy", "confidence": 0.8}]`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        maxTokens: 200,
      });
      
      // Parse response safely
      const match = response.content.match(/\[[\s\S]*\]/);
      if (!match) return [];
      
      let suggestions: TagSuggestion[];
      try {
        suggestions = JSON.parse(match[0]) as TagSuggestion[];
      } catch (parseError) {
        console.error('Failed to parse tag suggestions:', parseError);
        return [];
      }
      
      // Validate and filter suggestions
      if (!Array.isArray(suggestions)) return [];
      
      return suggestions
        .filter(s => 
          typeof s.tag === 'string' && 
          typeof s.confidence === 'number' &&
          s.confidence >= 0.3 &&
          s.tag.length > 0 &&
          s.tag.length < 100
        )
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, this.settings.maxTagSuggestions);
        
    } catch (error) {
      console.error('Tag suggestion failed:', error);
      return [];
    }
  }

  /**
   * Apply tags to a file
   */
  async applyTags(file: TFile, tags: string[]): Promise<void> {
    if (tags.length === 0) return;
    
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const existingTags = fm.tags || [];
      const tagsArray = Array.isArray(existingTags) ? existingTags : [existingTags];
      
      // Add new tags, avoiding duplicates
      for (const tag of tags) {
        const normalizedTag = tag.startsWith('#') ? tag.slice(1) : tag;
        if (!tagsArray.includes(normalizedTag)) {
          tagsArray.push(normalizedTag);
        }
      }
      
      fm.tags = tagsArray;
    });
  }

  /**
   * Get all tags used in the vault (cached, limited)
   */
  private getVaultTags(): string[] {
    const tags = new Set<string>();
    const cache = this.app.metadataCache;
    const files = this.app.vault.getMarkdownFiles();
    
    // Limit iteration to prevent freezing on large vaults
    const maxFilesToScan = 500;
    const filesToScan = files.slice(0, maxFilesToScan);
    
    for (const file of filesToScan) {
      // Get tags from cache (fast, doesn't read file)
      const fileCache = cache.getFileCache(file);
      if (!fileCache) continue;
      
      const fileTags = fileCache.tags || [];
      for (const tagInfo of fileTags) {
        tags.add(tagInfo.tag.replace(/^#/, ''));
        if (tags.size >= 100) break; // Limit total tags
      }
      
      // Also check frontmatter
      const frontmatter = fileCache.frontmatter;
      if (frontmatter?.tags) {
        const fmTags = Array.isArray(frontmatter.tags) 
          ? frontmatter.tags 
          : [frontmatter.tags];
        for (const tag of fmTags) {
          if (typeof tag === 'string') {
            tags.add(tag.replace(/^#/, ''));
            if (tags.size >= 100) break;
          }
        }
      }
      
      if (tags.size >= 100) break;
    }
    
    return Array.from(tags);
  }

  /**
   * Build the tagging prompt
   */
  private buildTagPrompt(content: string, existingTags: string[]): string {
    let prompt = `Suggest tags for this note based on its content.

Note Title & Content:
${content.slice(0, 2000)}${content.length > 2000 ? '...' : ''}
`;

    if (existingTags.length > 0) {
      prompt += `
Existing tags in this vault (prefer these when they fit):
${existingTags.slice(0, 50).join(', ')}
`;
    }

    prompt += `
Suggest ${this.settings.maxTagSuggestions} tags that describe WHAT this note is about.
Format: [{"tag": "topic-name", "confidence": 0.9}, ...]`;

    return prompt;
  }

  /**
   * Process queued files with circuit breaker
   */
  private async processTagQueue(): Promise<void> {
    if (this.isProcessing || this.tagQueue.size === 0) return;
    if (this.circuitBroken) {
      this.tagQueue.clear();
      return;
    }
    
    this.isProcessing = true;
    
    try {
      const paths = Array.from(this.tagQueue);
      this.tagQueue.clear();
      
      // In 'suggest' mode, background processing is disabled
      // User must manually invoke the command to see the modal
      if (this.settings.autoTagMode === 'suggest') {
        // Skip background processing in suggest mode
        return;
      }
      
      for (const path of paths) {
        if (this.circuitBroken) break;
        
        const file = this.app.vault.getFileByPath(path);
        if (!(file instanceof TFile)) continue;
        
        // Yield to UI between files
        await this.yieldToUI();
        
        try {
          const suggestions = await this.suggestTags(file);
          this.consecutiveErrors = 0; // Reset on success
          
          if (suggestions.length === 0) continue;
          
          // Auto-apply high-confidence tags (only mode that reaches here)
          const highConfidence = suggestions
            .filter(s => s.confidence >= this.settings.autoTagConfidence)
            .map(s => s.tag);
          
          if (highConfidence.length > 0) {
            await this.applyTags(file, highConfidence);
            new Notice(`Calcifer: Added tags to ${file.basename}: ${highConfidence.join(', ')}`);
          }
        } catch (error) {
          console.error(`Failed to tag ${path}:`, error);
          this.consecutiveErrors++;
          
          if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
            this.circuitBroken = true;
            console.warn('[Calcifer] Auto-tagging circuit breaker triggered');
            break;
          }
        }
      }
    } finally {
      this.isProcessing = false;
      
      // Process any files added during processing (only if circuit not broken)
      if (this.tagQueue.size > 0 && !this.circuitBroken) {
        this.processQueue();
      }
    }
  }
  
  /**
   * Yield to UI
   */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: 50 });
      } else {
        setTimeout(resolve, 10);
      }
    });
  }
}

/**
 * Modal for tag suggestions
 */
class TagSuggestionModal extends Modal {
  private file: TFile;
  private suggestions: TagSuggestion[];
  private tagger: AutoTagger;
  private selectedTags: Set<string> = new Set();

  constructor(
    app: App,
    file: TFile,
    suggestions: TagSuggestion[],
    tagger: AutoTagger
  ) {
    super(app);
    this.file = file;
    this.suggestions = suggestions;
    this.tagger = tagger;
    // Pre-select high confidence tags
    for (const s of suggestions) {
      if (s.confidence >= 0.7) {
        this.selectedTags.add(s.tag);
      }
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('calcifer-tag-modal');

    contentEl.createEl('h2', { text: `Tag "${this.file.basename}"` });
    contentEl.createEl('p', { 
      text: 'Select tags to apply to this note:',
      cls: 'calcifer-tag-modal-desc'
    });

    const suggestionsEl = contentEl.createDiv({ cls: 'calcifer-tag-suggestions' });

    for (const suggestion of this.suggestions) {
      const item = suggestionsEl.createDiv({ cls: 'calcifer-tag-suggestion' });
      
      const checkbox = item.createEl('input', { type: 'checkbox' });
      checkbox.checked = this.selectedTags.has(suggestion.tag);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          this.selectedTags.add(suggestion.tag);
        } else {
          this.selectedTags.delete(suggestion.tag);
        }
      });
      
      const labelEl = item.createDiv({ cls: 'calcifer-tag-label' });
      labelEl.createSpan({ text: `#${suggestion.tag}`, cls: 'calcifer-tag-name' });
      labelEl.createSpan({ 
        cls: 'calcifer-tag-confidence',
        text: `${Math.round(suggestion.confidence * 100)}%`
      });
      
      // Click label to toggle checkbox
      labelEl.addEventListener('click', () => {
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
    }

    // Action buttons
    new Setting(contentEl)
      .addButton(button => button
        .setButtonText('Apply Selected')
        .setCta()
        .onClick(async () => {
          if (this.selectedTags.size > 0) {
            await this.tagger.applyTags(this.file, Array.from(this.selectedTags));
            new Notice(`Added tags to ${this.file.basename}: ${Array.from(this.selectedTags).join(', ')}`);
          }
          this.close();
        })
      )
      .addButton(button => button
        .setButtonText('Skip')
        .onClick(() => this.close())
      );
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
