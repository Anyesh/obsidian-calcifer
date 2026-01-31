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
      request.onerror = () => reject(new Error(`Failed to upsert: ${request.error?.message}`));
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
   * Update file path for renamed files
   */
  async updatePath(oldPath: string, newPath: string): Promise<void> {
    const docs = await this.getByPath(oldPath);
    
    for (const doc of docs) {
      doc.path = newPath;
      doc.id = `${newPath}#${doc.chunkIndex}`;
      await this.upsert(doc);
    }
    
    // Delete old entries
    await this.deleteByPath(oldPath);
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
   */
  async search(
    queryEmbedding: number[],
    topK: number = 5,
    minScore: number = 0
  ): Promise<SearchResult[]> {
    const allDocs = await this.getAll();
    
    // Calculate similarity scores
    const results: SearchResult[] = [];
    
    for (const doc of allDocs) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding);
      
      if (score >= minScore) {
        results.push({ document: doc, score });
      }
    }
    
    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
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
    
    for (const path of filePaths) {
      const docs = await this.getByPath(path);
      
      for (const doc of docs) {
        const score = cosineSimilarity(queryEmbedding, doc.embedding);
        
        if (score >= minScore) {
          results.push({ document: doc, score });
        }
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
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
