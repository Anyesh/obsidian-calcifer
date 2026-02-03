/**
 * Embedding Manager
 * 
 * Orchestrates vault indexing with embeddings.
 * Handles batch processing, debouncing, and progress tracking.
 */

import { App, TFile, Notice, Platform } from 'obsidian';
import type CalciferPlugin from '@/../main';
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
  private plugin: CalciferPlugin | null = null;
  private providerManager: ProviderManager;
  private vectorStore: VectorStore;
  private settings: CalciferSettings;
  
  // Queue for files to be indexed
  private indexQueue: Set<string> = new Set();
  private isIndexing = false;
  
  // Circuit breaker for connection errors
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 3;
  private circuitBroken = false;
  
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
    settings: CalciferSettings,
    plugin?: CalciferPlugin
  ) {
    this.app = app;
    this.plugin = plugin || null;
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
    const debounceChanged = this.settings.embeddingDebounceMs !== settings.embeddingDebounceMs;
    
    this.settings = settings;
    this.rateLimiter = new RateLimiter(settings.rateLimitRpm);
    
    // Recreate debounced function if delay changed
    if (debounceChanged) {
      this.processQueue = debounce(() => {
        this.processIndexQueue();
      }, settings.embeddingDebounceMs);
    }
    
    // Reset circuit breaker when settings change
    this.circuitBroken = false;
    this.consecutiveErrors = 0;
  }

  /**
   * Reset circuit breaker (call after fixing connection issues)
   */
  resetCircuitBreaker(): void {
    this.circuitBroken = false;
    this.consecutiveErrors = 0;
  }

  /**
   * Force stop all indexing immediately
   */
  forceStop(): void {
    this.circuitBroken = true;
    this.indexQueue.clear();
    this.isIndexing = false;
    this.progress = null;
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
    if (this.circuitBroken) return; // Don't queue if circuit is broken
    if (!this.plugin?.providerManager?.hasAvailableProvider()) return; // No provider available
    if (Platform.isMobile && !this.settings.enableOnMobile) return; // Mobile check
    
    this.indexQueue.add(path);
    this.processQueue();
  }

  /**
   * Index a specific file immediately
   */
  async indexFile(file: TFile): Promise<void> {
    if (!this.settings.enableEmbedding) return;
    if (this.shouldExclude(file.path)) return;
    if (this.circuitBroken) return;
    if (Platform.isMobile && !this.settings.enableOnMobile) return; // Mobile check
    
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
    
    if (Platform.isMobile && !this.settings.enableOnMobile) {
      new Notice('Embedding is disabled on mobile. Enable in settings.');
      return;
    }
    
    if (this.isIndexing) {
      new Notice('Indexing already in progress');
      return;
    }

    // Reset circuit breaker for manual reindex
    this.circuitBroken = false;
    this.consecutiveErrors = 0;
    
    this.isIndexing = true;
    
    try {
      // Health check before starting
      const healthResults = await this.providerManager.checkAllHealth();
      
      // Find the first healthy provider
      let healthCheck = null;
      for (const [id, result] of healthResults) {
        if (result.healthy) {
          healthCheck = result;
          break;
        }
      }
      
      if (!healthCheck) {
        const errors = Array.from(healthResults.values())
          .map(r => r.error)
          .filter(Boolean)
          .join(', ');
        new Notice(`Provider connection failed: ${errors || 'Unknown error'}\n\nTry enabling "Use native fetch" in settings if using localhost.`, 10000);
        this.isIndexing = false;
        return;
      }
      
      if (!healthCheck.modelInfo?.embeddingAvailable) {
        new Notice(`Embedding model not found on server. Check settings.`, 5000);
        this.isIndexing = false;
        return;
      }
      
      
      const files = this.app.vault.getMarkdownFiles()
        .filter(f => !this.shouldExclude(f.path));
      
      // Yield before expensive IndexedDB operation
      await this.yieldToUI();
      
      // Get all indexed paths with mtimes in ONE query (not per-file)
      const indexedPaths = force ? new Map<string, number>() : await this.vectorStore.getIndexedPathsWithMtime();
      
      // Yield after IndexedDB operation
      await this.yieldToUI();
      
      const filesToIndex: TFile[] = [];
      
      for (const file of files) {
        if (force) {
          filesToIndex.push(file);
        } else {
          const indexedMtime = indexedPaths.get(file.path);
          if (!indexedMtime || file.stat.mtime > indexedMtime) {
            filesToIndex.push(file);
          }
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
      
      // Process files in small batches with yielding to prevent UI freeze
      const FILES_PER_YIELD = 1; // Process 1 file at a time for maximum responsiveness
      
      
      for (let i = 0; i < filesToIndex.length; i++) {
        // Check circuit breaker
        if (this.circuitBroken) {
          new Notice('Indexing stopped due to connection errors. Check settings.', 5000);
          break;
        }

        const file = filesToIndex[i];
        
        try {
          this.progress!.current = file.basename;
          this.progressCallback?.(this.progress!);
          
          
          await this.indexSingleFile(file);
          
          
          this.progress!.completed++;
          this.consecutiveErrors = 0; // Reset on success
          
        } catch (error) {
          console.error(`Failed to index ${file.path}:`, error);
          this.progress!.errors++;
          
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (this.isConnectionError(errorMessage)) {
            this.consecutiveErrors++;
            if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
              this.circuitBroken = true;
              new Notice('Calcifer: Indexing paused - connection error. Check API settings.', 10000);
              break;
            }
          }
        }
        
        // Update progress every file
        this.progressCallback?.(this.progress!);
        
        // Yield to UI after each file to keep responsive
        // Using requestAnimationFrame for smoother UI updates
        await this.yieldToUIFrame();
      }
      
      if (this.settings.showIndexingProgress && !this.circuitBroken) {
        const { completed, errors } = this.progress!;
        new Notice(`Indexing complete: ${completed} files, ${errors} errors`);
      }
      
      
    } finally {
      this.isIndexing = false;
      this.progress = null;
    }
  }

  /**
   * Yield control back to the UI to prevent freezing
   * Uses a short timeout to allow the browser to process pending UI updates
   */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Yield using requestAnimationFrame for smoother UI updates
   * This ensures the browser has a chance to paint before we continue
   */
  private yieldToUIFrame(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          // Double RAF to ensure we've actually yielded a frame
          requestAnimationFrame(() => resolve());
        });
      } else {
        setTimeout(resolve, 16); // ~1 frame at 60fps
      }
    });
  }

  /**
   * Longer yield for after heavy operations
   */
  private yieldToUILong(): Promise<void> {
    return new Promise(resolve => {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => resolve(), { timeout: 100 });
      } else {
        setTimeout(resolve, 16); // ~1 frame at 60fps
      }
    });
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
    if (this.circuitBroken) {
      console.warn('[Calcifer] Circuit breaker active - skipping indexing');
      this.indexQueue.clear();
      return;
    }
    
    this.isIndexing = true;
    
    try {
      const paths = Array.from(this.indexQueue);
      this.indexQueue.clear();
      
      for (let i = 0; i < paths.length; i++) {
        if (this.circuitBroken) break;
        
        const path = paths[i];
        const file = this.app.vault.getFileByPath(path);
        if (file && file instanceof TFile) {
          try {
            await this.indexSingleFile(file);
            // Reset error count on success
            this.consecutiveErrors = 0;
          } catch (error) {
            console.error(`Failed to index ${path}:`, error);
            
            // Check for connection/certificate errors
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (this.isConnectionError(errorMessage)) {
              this.consecutiveErrors++;
              console.error(`[Calcifer] Connection error (${this.consecutiveErrors}/${this.maxConsecutiveErrors})`);
              
              if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                this.circuitBroken = true;
                new Notice('Calcifer: Indexing paused due to connection errors. Check your API endpoint settings.', 10000);
                break;
              }
            }
          }
        }
        
        // Yield to UI after each file
        await this.yieldToUIFrame();
      }
    } finally {
      this.isIndexing = false;
      
      // Process any files added during indexing (only if circuit not broken)
      if (this.indexQueue.size > 0 && !this.circuitBroken) {
        this.processQueue();
      }
    }
  }

  /**
   * Check if error is a connection/certificate error
   */
  private isConnectionError(message: string): boolean {
    const connectionErrors = [
      'ERR_CERT_AUTHORITY_INVALID',
      'ERR_CERT_COMMON_NAME_INVALID',
      'ERR_CONNECTION_REFUSED',
      'ERR_CONNECTION_RESET',
      'ERR_CONNECTION_CLOSED',
      'ERR_NAME_NOT_RESOLVED',
      'ERR_NETWORK',
      'ERR_INTERNET_DISCONNECTED',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'fetch failed',
      'Connection failed',
      'status 404',  // Model not found
      'status 500',  // Server error
      'All providers failed',  // Provider manager exhausted
    ];
    
    return connectionErrors.some(err => message.includes(err));
  }

  /**
   * Index a single file
   */
  private async indexSingleFile(file: TFile): Promise<void> {
    // Read file content
    const content = await this.app.vault.cachedRead(file);
    
    // Extract frontmatter
    const metadata = extractFrontmatter(content);
    
    // Chunk the content (synchronous but fast for normal files)
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
    
    // Generate embeddings in batches
    const documents: VectorDocument[] = [];
    const batchSize = Math.max(1, this.settings.embeddingBatchSize);
    
    for (let i = 0; i < chunks.length; i += batchSize) {
      
      // Check if stopped
      if (this.circuitBroken) {
        throw new Error('Indexing stopped');
      }
      
      const batch = chunks.slice(i, i + batchSize);
      
      // Rate limit - with timeout fallback
      const rateLimitPromise = this.rateLimiter.acquire();
      const rateLimitTimeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          console.warn(`[Calcifer]   Rate limiter taking too long, proceeding anyway`);
          resolve();
        }, 5000);
      });
      await Promise.race([rateLimitPromise, rateLimitTimeout]);
      
      try {
        // Batch embed call - send multiple texts at once
        const response = await this.providerManager.embed({
          input: batch.map(chunk => chunk.content),
          model: '', // Use default from provider
        });
        
        // Map embeddings back to chunks
        for (let j = 0; j < batch.length && j < response.embeddings.length; j++) {
          const chunk = batch[j];
          documents.push({
            id: `${file.path}#${chunk.index}`,
            path: file.path,
            chunkIndex: chunk.index,
            content: chunk.content,
            embedding: response.embeddings[j],
            mtime: file.stat.mtime,
            metadata: metadata ?? undefined,
            createdAt: Date.now(),
          });
        }
      } catch (error) {
        console.error(`[Calcifer]   Embed API FAILED for batch ${i}:`, error);
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
