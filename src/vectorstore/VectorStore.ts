/**
 * Vector Store
 * 
 * IndexedDB-based vector storage for embeddings.
 * Supports CRUD operations and similarity search.
 * Works on both desktop and mobile.
 */

import { App, TFile } from 'obsidian';

/**
 * Stored vector document
 */
export interface VectorDocument {
  /** Unique identifier (typically path + chunk index) */
  id: string;
  /** Source file path */
  path: string;
  /** Chunk index within the file */
  chunkIndex: number;
  /** Original text content */
  content: string;
  /** Embedding vector */
  embedding: number[];
  /** File modification time when indexed */
  mtime: number;
  /** Metadata from frontmatter */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: number;
}

/**
 * Search result with similarity score
 */
export interface SearchResult {
  document: VectorDocument;
  score: number;
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
  documentCount: number;
  uniqueFiles: number;
  totalChunks: number;
  dbSizeBytes: number;
}

// IndexedDB database name and version
const DB_NAME = 'calcifer-vectors';
const DB_VERSION = 1;
const STORE_NAME = 'vectors';

/**
 * Vector Store Implementation using IndexedDB
 */
export class VectorStore {
  private app: App;
  private db: IDBDatabase | null = null;
  private isInitialized = false;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Initialize the vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create vectors store with indexes
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('path', 'path', { unique: false });
          store.createIndex('mtime', 'mtime', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }

  /**
   * Ensure database is initialized
   */
  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('VectorStore not initialized. Call initialize() first.');
    }
  }

  /**
   * Add or update a vector document
   */
  async upsert(doc: VectorDocument): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(doc);

      request.onsuccess = () => resolve();
      request.onerror = () => {
        const error = request.error;
        if (error?.name === 'QuotaExceededError') {
          reject(new Error('Storage quota exceeded. Try clearing the embedding index.'));
        } else {
          reject(new Error(`Failed to upsert: ${error?.message}`));
        }
      };
    });
  }

  /**
   * Add or update multiple vector documents
   */
  async upsertBatch(docs: VectorDocument[]): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      let completed = 0;
      let hasError = false;
      
      // Handle transaction-level errors (including quota)
      transaction.onerror = () => {
        if (!hasError) {
          hasError = true;
          const error = transaction.error;
          if (error?.name === 'QuotaExceededError') {
            reject(new Error('Storage quota exceeded. Try clearing the embedding index.'));
          } else {
            reject(new Error(`Transaction failed: ${error?.message}`));
          }
        }
      };

      for (const doc of docs) {
        const request = store.put(doc);
        
        request.onsuccess = () => {
          completed++;
          if (completed === docs.length && !hasError) {
            resolve();
          }
        };
        
        request.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(new Error(`Failed to upsert batch: ${request.error?.message}`));
          }
        };
      }

      // Handle empty batch
      if (docs.length === 0) {
        resolve();
      }
    });
  }

  /**
   * Get a document by ID
   */
  async get(id: string): Promise<VectorDocument | null> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(new Error(`Failed to get: ${request.error?.message}`));
    });
  }

  /**
   * Get all documents for a file path
   */
  async getByPath(path: string): Promise<VectorDocument[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('path');
      const request = index.getAll(path);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error(`Failed to getByPath: ${request.error?.message}`));
    });
  }

  /**
   * Delete a document by ID
   */
  async delete(id: string): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete: ${request.error?.message}`));
    });
  }

  /**
   * Delete all documents for a file path
   */
  async deleteByPath(path: string): Promise<void> {
    this.ensureInitialized();

    const docs = await this.getByPath(path);
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      let completed = 0;
      let hasError = false;

      for (const doc of docs) {
        const request = store.delete(doc.id);
        
        request.onsuccess = () => {
          completed++;
          if (completed === docs.length && !hasError) {
            resolve();
          }
        };
        
        request.onerror = () => {
          if (!hasError) {
            hasError = true;
            reject(new Error(`Failed to delete by path: ${request.error?.message}`));
          }
        };
      }

      // Handle empty result
      if (docs.length === 0) {
        resolve();
      }
    });
  }

  /**
   * Update file path for renamed files - atomic transaction
   */
  async updatePath(oldPath: string, newPath: string): Promise<void> {
    this.ensureInitialized();
    
    const docs = await this.getByPath(oldPath);
    if (docs.length === 0) return;
    
    // Use a single transaction for atomicity
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      let completed = 0;
      const totalOps = docs.length * 2; // delete old + add new for each doc
      let hasError = false;
      
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => {
        if (!hasError) {
          hasError = true;
          reject(new Error(`Failed to update path: ${transaction.error?.message}`));
        }
      };
      transaction.onabort = () => {
        if (!hasError) {
          hasError = true;
          reject(new Error('Transaction aborted'));
        }
      };
      
      for (const doc of docs) {
        // Delete old entry
        const deleteRequest = store.delete(doc.id);
        deleteRequest.onsuccess = () => {
          completed++;
        };
        
        // Create new entry with updated path
        const newDoc = {
          ...doc,
          path: newPath,
          id: `${newPath}#${doc.chunkIndex}`,
        };
        const addRequest = store.put(newDoc);
        addRequest.onsuccess = () => {
          completed++;
        };
      }
    });
  }

  /**
   * Clear all documents
   */
  async clear(): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to clear: ${request.error?.message}`));
    });
  }

  /**
   * Get all documents
   */
  async getAll(): Promise<VectorDocument[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error(`Failed to getAll: ${request.error?.message}`));
    });
  }

  /**
   * Search for similar documents using cosine similarity
   * Processes in batches to prevent UI freezing
   */
  async search(
    queryEmbedding: number[],
    topK: number = 5,
    minScore: number = 0
  ): Promise<SearchResult[]> {
    this.ensureInitialized();
    
    // Get all documents in batches to prevent memory issues with large vaults
    const allDocs = await this.getAllInBatches(500);
    
    const results: SearchResult[] = [];
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < allDocs.length; i += BATCH_SIZE) {
      const batch = allDocs.slice(i, i + BATCH_SIZE);
      
      for (const doc of batch) {
        const score = cosineSimilarity(queryEmbedding, doc.embedding);
        
        if (score >= minScore) {
          // Keep only top K results using min-heap logic
          if (results.length < topK) {
            results.push({ document: doc, score });
            results.sort((a, b) => a.score - b.score); // Keep sorted ascending
          } else if (score > results[0].score) {
            results[0] = { document: doc, score };
            results.sort((a, b) => a.score - b.score);
          }
        }
      }
      
      // Yield to UI between batches
      if (i + BATCH_SIZE < allDocs.length) {
        await this.yieldToUI();
      }
    }
    
    // Return results sorted descending
    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /**
   * Get all documents in batches to allow UI updates
   */
  private async getAllInBatches(batchSize: number): Promise<VectorDocument[]> {
    this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(new Error(`Failed to getAll: ${request.error?.message}`));
    });
  }

  /**
   * Yield to UI to prevent freezing during search
   */
  private yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  /**
   * Search within specific files
   */
  async searchInFiles(
    queryEmbedding: number[],
    filePaths: string[],
    topK: number = 5,
    minScore: number = 0
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const pathSet = new Set(filePaths);
    
    this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        
        if (cursor) {
          const doc = cursor.value as VectorDocument;
          
          if (pathSet.has(doc.path)) {
            const score = cosineSimilarity(queryEmbedding, doc.embedding);
            
            if (score >= minScore) {
              if (results.length < topK) {
                results.push({ document: doc, score });
                results.sort((a, b) => a.score - b.score);
              } else if (score > results[0].score) {
                results[0] = { document: doc, score };
                results.sort((a, b) => a.score - b.score);
              }
            }
          }
          
          cursor.continue();
        } else {
          results.sort((a, b) => b.score - a.score);
          resolve(results);
        }
      };
      
      request.onerror = () => {
        reject(new Error(`Search in files failed: ${request.error?.message}`));
      };
    });
  }

  /**
   * Check if a file needs re-indexing based on mtime
   */
  async needsReindex(file: TFile): Promise<boolean> {
    const docs = await this.getByPath(file.path);
    
    if (docs.length === 0) {
      return true; // Not indexed yet
    }
    
    // Check if file has been modified since last index
    const lastIndexedMtime = Math.max(...docs.map(d => d.mtime));
    return file.stat.mtime > lastIndexedMtime;
  }

  /**
   * Get indexed file paths
   */
  async getIndexedPaths(): Promise<Set<string>> {
    const allDocs = await this.getAll();
    return new Set(allDocs.map(d => d.path));
  }

  /**
   * Get indexed file paths with their latest mtime
   * Used for efficient batch reindex checking
   */
  async getIndexedPathsWithMtime(): Promise<Map<string, number>> {
    this.ensureInitialized();
    
    const pathMtimes = new Map<string, number>();
    let docCount = 0;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        
        if (cursor) {
          docCount++;
          const doc = cursor.value as VectorDocument;
          const existingMtime = pathMtimes.get(doc.path) || 0;
          if (doc.mtime > existingMtime) {
            pathMtimes.set(doc.path, doc.mtime);
          }
          cursor.continue();
        } else {
          resolve(pathMtimes);
        }
      };
      
      request.onerror = () => {
        reject(new Error(`Failed to get indexed paths: ${request.error?.message}`));
      };
    });
  }

  /**
   * Get store statistics
   */
  async getStats(): Promise<VectorStoreStats> {
    const allDocs = await this.getAll();
    const paths = new Set(allDocs.map(d => d.path));
    
    // Estimate size (rough approximation)
    const sizeEstimate = allDocs.reduce((total, doc) => {
      return total + 
        doc.content.length * 2 + // UTF-16
        doc.embedding.length * 8 + // Float64
        100; // Overhead
    }, 0);
    
    return {
      documentCount: allDocs.length,
      uniqueFiles: paths.size,
      totalChunks: allDocs.length,
      dbSizeBytes: sizeEstimate,
    };
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) {
    return 0;
  }
  
  return dotProduct / (normA * normB);
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Vectors must have the same dimension');
  }
  
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  
  return Math.sqrt(sum);
}
