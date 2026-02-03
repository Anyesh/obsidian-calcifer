/**
 * Memory Manager
 * 
 * Manages persistent memories for the AI assistant.
 * Stores facts and preferences about the user.
 */

import type CalciferPlugin from '@/../main';

/**
 * Memory entry
 */
export interface Memory {
  id: string;
  content: string;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  source?: string;
}

/**
 * Memory data stored in plugin data
 */
interface MemoryData {
  memories: Memory[];
  version: number;
}

/**
 * Plugin data shape that may contain memory data
 */
interface PluginData {
  [key: string]: unknown;
}

const MEMORY_DATA_KEY = 'calcifer-memories';
const CURRENT_VERSION = 1;

/**
 * Memory Manager
 */
export class MemoryManager {
  private plugin: CalciferPlugin;
  private memories: Memory[] = [];
  private isLoaded = false;

  constructor(plugin: CalciferPlugin) {
    this.plugin = plugin;
  }

  /**
   * Load memories from storage
   */
  async load(): Promise<void> {
    try {
      const data = await this.plugin.loadData() as PluginData | null;
      const memoryData = data?.[MEMORY_DATA_KEY] as MemoryData | undefined;
      
      if (memoryData && memoryData.version === CURRENT_VERSION) {
        this.memories = memoryData.memories;
      } else {
        this.memories = [];
      }
      
      this.isLoaded = true;
    } catch (error) {
      console.error('Failed to load memories:', error);
      this.memories = [];
      this.isLoaded = true;
    }
  }

  /**
   * Save memories to storage
   */
  async save(): Promise<void> {
    try {
      const existingData = (await this.plugin.loadData() as PluginData | null) || {};
      existingData[MEMORY_DATA_KEY] = {
        memories: this.memories,
        version: CURRENT_VERSION,
      };
      await this.plugin.saveData(existingData);
    } catch (error) {
      console.error('Failed to save memories:', error);
    }
  }

  /**
   * Add a new memory
   */
  async addMemory(content: string, source?: string): Promise<Memory> {
    // Check for duplicates or very similar memories
    const isDuplicate = this.memories.some(m => 
      this.calculateSimilarity(m.content, content) > 0.9
    );
    
    if (isDuplicate) {
      // Return existing similar memory
      const existing = this.memories.find(m => 
        this.calculateSimilarity(m.content, content) > 0.9
      )!;
      existing.lastAccessedAt = Date.now();
      existing.accessCount++;
      await this.save();
      return existing;
    }
    
    // Enforce max memories limit
    if (this.memories.length >= this.plugin.settings.maxMemories) {
      // Remove least accessed memory
      this.memories.sort((a, b) => a.accessCount - b.accessCount);
      this.memories.shift();
    }
    
    const memory: Memory = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      content,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      source,
    };
    
    this.memories.push(memory);
    await this.save();
    
    return memory;
  }

  /**
   * Get a memory by ID
   */
  getMemory(id: string): Memory | undefined {
    return this.memories.find(m => m.id === id);
  }

  /**
   * Get all memories
   */
  getAllMemories(): Memory[] {
    return [...this.memories].sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Get memory count
   */
  getMemoryCount(): number {
    return this.memories.length;
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    const index = this.memories.findIndex(m => m.id === id);
    if (index === -1) return false;
    
    this.memories.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Clear all memories
   */
  async clearAllMemories(): Promise<void> {
    this.memories = [];
    await this.save();
  }

  /**
   * Get relevant memories for a query
   */
  getRelevantMemories(query: string, limit: number = 5): string[] {
    if (this.memories.length === 0) return [];
    
    // Score memories based on keyword overlap
    const queryWords = this.tokenize(query.toLowerCase());
    
    const scored = this.memories.map(memory => {
      const memoryWords = this.tokenize(memory.content.toLowerCase());
      const overlap = queryWords.filter(w => memoryWords.includes(w)).length;
      const score = overlap / Math.max(queryWords.length, 1);
      
      return { memory, score };
    });
    
    // Sort by score and access frequency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.memory.accessCount - a.memory.accessCount;
    });
    
    // Update access times for returned memories
    const relevant = scored
      .filter(s => s.score > 0)
      .slice(0, limit);
    
    for (const { memory } of relevant) {
      memory.lastAccessedAt = Date.now();
      memory.accessCount++;
    }
    
    // Save if we updated any
    if (relevant.length > 0) {
      void this.save(); // Don't await, fire and forget
    }
    
    return relevant.map(s => s.memory.content);
  }

  /**
   * Search memories by content
   */
  searchMemories(query: string): Memory[] {
    const queryLower = query.toLowerCase();
    
    return this.memories
      .filter(m => m.content.toLowerCase().includes(queryLower))
      .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  /**
   * Update a memory's content
   */
  async updateMemory(id: string, content: string): Promise<boolean> {
    const memory = this.memories.find(m => m.id === id);
    if (!memory) return false;
    
    memory.content = content;
    memory.lastAccessedAt = Date.now();
    await this.save();
    return true;
  }

  /**
   * Simple text similarity using Jaccard index
   */
  private calculateSimilarity(a: string, b: string): number {
    const wordsA = new Set(this.tokenize(a.toLowerCase()));
    const wordsB = new Set(this.tokenize(b.toLowerCase()));
    
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
  }
}
