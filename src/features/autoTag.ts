/**
 * Auto-Tagger
 * 
 * Suggests or automatically applies tags to notes based on content.
 */

import { App, TFile, Notice } from 'obsidian';
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
   * Queue a file for tagging
   */
  queueFile(path: string): void {
    if (!this.settings.enableAutoTag) return;
    if (this.circuitBroken) return;
    
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
   * Suggest tags for a file
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
            content: 'You are a tag suggestion assistant. Analyze the content and suggest relevant tags. Return ONLY a JSON array of objects with "tag" and "confidence" (0-1) properties.',
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
    let prompt = `Analyze this note and suggest relevant tags.

Note Content:
${content.slice(0, 2000)}${content.length > 2000 ? '...' : ''}
`;

    if (existingTags.length > 0) {
      prompt += `
Existing vault tags (prefer these when applicable):
${existingTags.slice(0, 50).join(', ')}
`;
    }

    prompt += `
Suggest ${this.settings.maxTagSuggestions} tags with confidence scores (0-1).
Format: [{"tag": "tag-name", "confidence": 0.9}, ...]

Important:
- Tags should be lowercase with hyphens
- Focus on topics, categories, and concepts
- Confidence should reflect how well the tag fits`;

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
          
          if (this.settings.autoTagMode === 'auto') {
            // Auto-apply high-confidence tags
            const highConfidence = suggestions
              .filter(s => s.confidence >= this.settings.autoTagConfidence)
              .map(s => s.tag);
            
            if (highConfidence.length > 0) {
              await this.applyTags(file, highConfidence);
              new Notice(`Calcifer: Added tags to ${file.basename}: ${highConfidence.join(', ')}`);
            }
          } else {
            // Just notify about suggestions
            const tagList = suggestions.map(s => s.tag).join(', ');
            new Notice(`Calcifer suggests tags for ${file.basename}: ${tagList}`);
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
