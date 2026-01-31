/**
 * Embedding Manager
 * 
 * Orchestrates vault indexing with embeddings.
 * Handles batch processing, debouncing, and progress tracking.
 */

import { App, TFile, Notice } from 'obsidian';
import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore, VectorDocument } from '@/vectorstore/VectorStore';
import { chunkText, extractFrontmatter } from '@/vectorstore/Chunker';
import type { CalciferSettings } from '@/settings';
import { debounce } from '@/utils/debounce';
import { RateLimiter } from '@/utils/rateLimiter';

/**
 * Indexing progress information
 */
export interface IndexingProgress {
  total: number;
  completed: number;
  current: string;
  errors: number;
}

/**
 * Embedding Manager
 */
export class EmbeddingManager {
  private app: App;
  private providerManager: ProviderManager;
  private vectorStore: VectorStore;
  private settings: CalciferSettings;
  
  // Queue for files to be indexed
  private indexQueue: Set<string> = new Set();
  private isIndexing = false;
  
  // Rate limiter
  private rateLimiter: RateLimiter;
  
  // Debounced index processor
  private processQueue: () => void;
  
  // Progress tracking
  private progress: IndexingProgress | null = null;
  private progressCallback: ((progress: IndexingProgress) => void) | null = null;

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
    
    this.rateLimiter = new RateLimiter(settings.rateLimitRpm);
    
    // Create debounced queue processor
    this.processQueue = debounce(() => {
      this.processIndexQueue();
    }, settings.embeddingDebounceMs);
  }

  /**
   * Update settings
   */
  updateSettings(settings: CalciferSettings): void {
    this.settings = settings;
    this.rateLimiter = new RateLimiter(settings.rateLimitRpm);
  }

  /**
   * Set progress callback
   */
  onProgress(callback: (progress: IndexingProgress) => void): void {
    this.progressCallback = callback;
  }

  /**
   * Add a file to the index queue
   */
  queueFile(path: string): void {
    if (!this.settings.enableEmbedding) return;
    if (this.shouldExclude(path)) return;
    
    this.indexQueue.add(path);
    this.processQueue();
  }

  /**
   * Index a specific file immediately
   */
  async indexFile(file: TFile): Promise<void> {
    if (!this.settings.enableEmbedding) return;
    if (this.shouldExclude(file.path)) return;
    
    await this.indexSingleFile(file);
  }

  /**
   * Index the entire vault
   */
  async indexVault(force: boolean = false): Promise<void> {
    if (!this.settings.enableEmbedding) {
      new Notice('Embedding is disabled in settings');
      return;
    }
    
    if (this.isIndexing) {
      new Notice('Indexing already in progress');
      return;
    }
    
    this.isIndexing = true;
    
    try {
      const files = this.app.vault.getMarkdownFiles()
        .filter(f => !this.shouldExclude(f.path));
      
      const filesToIndex: TFile[] = [];
      
      for (const file of files) {
        if (force || await this.vectorStore.needsReindex(file)) {
          filesToIndex.push(file);
        }
      }
      
      if (filesToIndex.length === 0) {
        if (this.settings.showIndexingProgress) {
          new Notice('All files are up to date');
        }
        return;
      }
      
      this.progress = {
        total: filesToIndex.length,
        completed: 0,
        current: '',
        errors: 0,
      };
      
      if (this.settings.showIndexingProgress) {
        new Notice(`Starting to index ${filesToIndex.length} files...`);
      }
      
      // Process in batches
      const batchSize = this.settings.embeddingBatchSize;
      
      for (let i = 0; i < filesToIndex.length; i += batchSize) {
        const batch = filesToIndex.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (file) => {
            try {
              this.progress!.current = file.basename;
              this.progressCallback?.(this.progress!);
              
              await this.indexSingleFile(file);
              this.progress!.completed++;
            } catch (error) {
              console.error(`Failed to index ${file.path}:`, error);
              this.progress!.errors++;
            }
          })
        );
        
        this.progressCallback?.(this.progress!);
      }
      
      if (this.settings.showIndexingProgress) {
        const { completed, errors } = this.progress!;
        new Notice(`Indexing complete: ${completed} files, ${errors} errors`);
      }
      
    } finally {
      this.isIndexing = false;
      this.progress = null;
    }
  }

  /**
   * Get current indexing progress
   */
  getProgress(): IndexingProgress | null {
    return this.progress;
  }

  /**
   * Check if indexing is in progress
   */
  isIndexingActive(): boolean {
    return this.isIndexing;
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.indexQueue.clear();
    this.progress = null;
  }

  /**
   * Process queued files
   */
  private async processIndexQueue(): Promise<void> {
    if (this.isIndexing || this.indexQueue.size === 0) return;
    
    this.isIndexing = true;
    
    try {
      const paths = Array.from(this.indexQueue);
      this.indexQueue.clear();
      
      for (const path of paths) {
        const file = this.app.vault.getFileByPath(path);
        if (file && file instanceof TFile) {
          try {
            await this.indexSingleFile(file);
          } catch (error) {
            console.error(`Failed to index ${path}:`, error);
          }
        }
      }
    } finally {
      this.isIndexing = false;
      
      // Process any files added during indexing
      if (this.indexQueue.size > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Index a single file
   */
  private async indexSingleFile(file: TFile): Promise<void> {
    // Read file content
    const content = await this.app.vault.cachedRead(file);
    
    // Extract frontmatter
    const metadata = extractFrontmatter(content);
    
    // Chunk the content
    const chunks = chunkText(content, {
      chunkSize: this.settings.chunkSize,
      overlap: this.settings.chunkOverlap,
    });
    
    if (chunks.length === 0) {
      // File is empty or only frontmatter
      await this.vectorStore.deleteByPath(file.path);
      return;
    }
    
    // Delete existing chunks for this file
    await this.vectorStore.deleteByPath(file.path);
    
    // Generate embeddings for each chunk
    const documents: VectorDocument[] = [];
    
    for (const chunk of chunks) {
      // Rate limit
      await this.rateLimiter.acquire();
      
      try {
        const response = await this.providerManager.embed({
          input: chunk.content,
          model: '', // Use default from provider
        });
        
        if (response.embeddings.length > 0) {
          documents.push({
            id: `${file.path}#${chunk.index}`,
            path: file.path,
            chunkIndex: chunk.index,
            content: chunk.content,
            embedding: response.embeddings[0],
            mtime: file.stat.mtime,
            metadata: metadata ?? undefined,
            createdAt: Date.now(),
          });
        }
      } catch (error) {
        console.error(`Failed to embed chunk ${chunk.index} of ${file.path}:`, error);
        throw error; // Re-throw to mark file as failed
      }
    }
    
    // Store all chunks
    await this.vectorStore.upsertBatch(documents);
  }

  /**
   * Check if a path should be excluded from indexing
   */
  private shouldExclude(path: string): boolean {
    for (const pattern of this.settings.embeddingExclude) {
      if (this.matchGlob(path, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob pattern matching
   */
  private matchGlob(path: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\*\*/g, '{{DOUBLE_STAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/{{DOUBLE_STAR}}/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }
}
