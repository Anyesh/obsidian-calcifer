/**
 * RAG Pipeline
 * 
 * Implements Retrieval-Augmented Generation for chat with vault context.
 * Now includes tool calling support for vault operations.
 */

import { ProviderManager } from '@/providers/ProviderManager';
import { VectorStore, SearchResult } from '@/vectorstore/VectorStore';
import { MemoryManager } from '@/features/memory';
import { ToolManager, ToolResult } from '@/tools';
import type { ChatMessage, ChatStreamChunk } from '@/providers/types';
import type { CalciferSettings } from '@/settings';

/**
 * RAG response with metadata
 */
export interface RAGResponse {
  content: string;
  contextSources: string[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  /** Tool call results if any tools were executed */
  toolResults?: ToolResult[];
  /** Summary of tool actions performed */
  toolSummary?: string;
}

/**
 * Context chunk for prompt building
 */
interface ContextChunk {
  content: string;
  source: string;
  score: number;
}

/** Common stop words to ignore when evaluating query substance */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'it', 'its', 'this', 'that', 'these', 'those', 'and', 'or', 'but',
  'not', 'so', 'if', 'as', 'has', 'have', 'had', 'my', 'me', 'i',
  'you', 'your', 'we', 'our', 'he', 'she', 'they', 'them',
]);

/** Patterns that indicate a conversational message not requiring vault context */
const CONVERSATIONAL_PATTERNS = [
  /^(hi|hey|hello|howdy|sup|yo|hiya|greetings)[\s!.,?]*$/i,
  /^(thanks|thank you|thx|ty|cheers|much appreciated)[\s!.,?]*$/i,
  /^(ok|okay|sure|got it|alright|cool|nice|great|awesome|perfect|sounds good|understood)[\s!.,?]*$/i,
  /^(yes|no|yep|nope|yeah|nah|yea|nay)[\s!.,?]*$/i,
  /^(bye|goodbye|see you|later|good night|good morning|gm|gn)[\s!.,?]*$/i,
  /^(what can you do|who are you|help me|how are you)[\s!.,?]*$/i,
  /^(lol|haha|hehe|lmao|rofl|xd)[\s!.,?]*$/i,
];

/**
 * RAG Pipeline
 */
export class RAGPipeline {
  private providerManager: ProviderManager;
  private vectorStore: VectorStore;
  private memoryManager: MemoryManager;
  private toolManager: ToolManager | null = null;
  private settings: CalciferSettings;

  constructor(
    providerManager: ProviderManager,
    vectorStore: VectorStore,
    memoryManager: MemoryManager,
    settings: CalciferSettings
  ) {
    this.providerManager = providerManager;
    this.vectorStore = vectorStore;
    this.memoryManager = memoryManager;
    this.settings = settings;
  }

  /**
   * Set the tool manager for executing vault operations
   */
  setToolManager(toolManager: ToolManager): void {
    this.toolManager = toolManager;
  }

  /**
   * Update settings
   */
  updateSettings(settings: CalciferSettings): void {
    this.settings = settings;
  }

  /**
   * Generate a response with RAG context
   */
  async chat(
    query: string,
    conversationHistory: ChatMessage[] = []
  ): Promise<RAGResponse> {
    // 1. Retrieve relevant context (skip for conversational messages)
    const shouldSearch = this.shouldRetrieveContext(query);
    const context = shouldSearch ? await this.retrieveContext(query) : [];
    
    // 2. Get relevant memories
    const memories = await this.getRelevantMemories(query);
    
    // 3. Build the prompt with context (now includes tool descriptions)
    const messages = this.buildPrompt(query, context, memories, conversationHistory);
    
    // 4. Get response from LLM
    const response = await this.providerManager.chat({
      messages,
      temperature: this.settings.chatTemperature,
      maxTokens: this.settings.chatMaxTokens,
    });
    
    // 5. Process tool calls if any
    let content = response.content;
    let toolResults: ToolResult[] | undefined;
    let toolSummary: string | undefined;
    
    if (this.toolManager && this.settings.enableToolCalling) {
      const processed = await this.toolManager.processResponse(response.content);
      content = processed.content;
      
      if (processed.hasToolCalls) {
        toolResults = processed.toolResults;
        toolSummary = processed.toolSummary;
        
        // If there are tool results, append them to the content for display
        if (toolSummary) {
          content = content.trim();
          if (content) {
            content += '\n\n**Actions performed:**\n' + toolSummary;
          } else {
            content = '**Actions performed:**\n' + toolSummary;
          }
        }
      }
    }
    
    // 6. Extract and store any new memories
    await this.extractMemories(query, content);
    
    // 7. Get unique source files
    const contextSources = [...new Set(context.map(c => c.source))];
    
    return {
      content,
      contextSources,
      usage: response.usage ? {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      } : undefined,
      toolResults,
      toolSummary,
    };
  }

  /**
   * Generate a streaming response with RAG context.
   * Tokens are emitted via onChunk; sources via onSources.
   * Tool processing happens after stream completes.
   */
  async chatStream(
    query: string,
    conversationHistory: ChatMessage[],
    onChunk: (chunk: ChatStreamChunk) => void,
    onSources: (sources: string[]) => void
  ): Promise<RAGResponse> {
    // 1. Retrieve context (with confidence gating)
    const shouldSearch = this.shouldRetrieveContext(query);
    const context = shouldSearch ? await this.retrieveContext(query) : [];

    // 2. Emit sources early so UI can render them before LLM responds
    const contextSources = [...new Set(context.map(c => c.source))];
    onSources(contextSources);

    // 3. Build prompt
    const memories = await this.getRelevantMemories(query);
    const messages = this.buildPrompt(query, context, memories, conversationHistory);

    // 4. Stream from provider
    const response = await this.providerManager.chatStream(
      {
        messages,
        temperature: this.settings.chatTemperature,
        maxTokens: this.settings.chatMaxTokens,
      },
      onChunk
    );

    // 5. Post-stream: tool processing on full text
    let content = response.content;
    let toolResults: ToolResult[] | undefined;
    let toolSummary: string | undefined;

    if (this.toolManager && this.settings.enableToolCalling) {
      const processed = await this.toolManager.processResponse(response.content);
      content = processed.content;

      if (processed.hasToolCalls) {
        toolResults = processed.toolResults;
        toolSummary = processed.toolSummary;
      }
    }

    // 6. Memory extraction (fire and forget)
    void this.extractMemories(query, content);

    return {
      content,
      contextSources,
      usage: response.usage ? {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
      } : undefined,
      toolResults,
      toolSummary,
    };
  }

  /**
   * Determine if a query warrants vault context retrieval.
   * Skips embedding + search for conversational messages like "hi", "thanks", etc.
   */
  private shouldRetrieveContext(query: string): boolean {
    if (!this.settings.enableConfidenceGating) return true;

    const trimmed = query.trim();

    // Match conversational patterns that never need vault context
    if (CONVERSATIONAL_PATTERNS.some(p => p.test(trimmed))) return false;

    // Check if query has enough substance (at least 2 non-stop-words)
    const words = trimmed.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !STOP_WORDS.has(w));
    if (words.length < 2) return false;

    return true;
  }

  /**
   * Retrieve relevant context from the vector store
   */
  private async retrieveContext(query: string): Promise<ContextChunk[]> {
    try {
      // Generate embedding for query
      const embeddingResponse = await this.providerManager.embed({
        input: query,
        model: '',
      });

      if (embeddingResponse.embeddings.length === 0) {
        return [];
      }

      const queryEmbedding = embeddingResponse.embeddings[0];

      // Search for similar chunks
      const results = await this.vectorStore.search(
        queryEmbedding,
        this.settings.ragTopK,
        this.settings.ragMinScore
      );

      if (results.length === 0) return [];

      // Post-search confidence filtering
      const topScore = results[0].score;

      // Hard floor: if even the best result is below the confidence floor, discard all
      if (topScore < this.settings.ragConfidenceFloor) {
        return [];
      }

      // Dynamic floor: results must be at least 60% of the best match
      const dynamicFloor = topScore * 0.6;
      const filtered = results.filter(r => r.score >= dynamicFloor);

      // Convert to context chunks with optional frontmatter
      const chunks = filtered.map(r => {
        let content = r.document.content;

        // Include frontmatter metadata if enabled
        if (this.settings.ragIncludeFrontmatter && r.document.metadata) {
          const metaStr = Object.entries(r.document.metadata)
            .filter((entry): entry is [string, unknown] => {
              const val = entry[1];
              return val !== null && val !== undefined;
            })
            .map(([k, v]) => {
              const value = Array.isArray(v) ? v.join(', ') : String(v);
              return `${k}: ${String(value)}`;
            })
            .join('\n');
          if (metaStr) {
            content = `---\n${metaStr}\n---\n\n${content}`;
          }
        }

        return {
          content,
          source: r.document.path,
          score: r.score,
        };
      });

      return this.deduplicateContext(chunks);

    } catch (error) {
      console.error('Failed to retrieve context:', error);
      return [];
    }
  }

  /**
   * Remove overlapping chunks from the same source file.
   * When chunks overlap (due to chunker overlap setting), the higher-scored one wins.
   */
  private deduplicateContext(chunks: ContextChunk[]): ContextChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: ContextChunk[] = [];

    for (const chunk of chunks) {
      const isDuplicate = result.some(existing => {
        // Only check chunks from the same source file
        if (existing.source !== chunk.source) return false;

        // Check if the middle portion of the shorter text appears in the longer
        const shorter = chunk.content.length < existing.content.length ? chunk.content : existing.content;
        const longer = chunk.content.length >= existing.content.length ? chunk.content : existing.content;

        // Use a core sample from the middle (skip boundaries which are most likely to differ)
        const sampleStart = Math.min(50, Math.floor(shorter.length * 0.2));
        const sampleEnd = Math.max(shorter.length - 50, Math.ceil(shorter.length * 0.8));
        if (sampleEnd <= sampleStart) return false;

        const sample = shorter.slice(sampleStart, sampleEnd);
        return sample.length > 0 && longer.includes(sample);
      });

      if (!isDuplicate) {
        result.push(chunk);
      }
    }

    return result;
  }

  /**
   * Get relevant memories for the query
   */
  private async getRelevantMemories(query: string): Promise<string[]> {
    if (!this.settings.enableMemory || !this.settings.includeMemoriesInContext) {
      return [];
    }

    return this.memoryManager.getRelevantMemories(query);
  }

  /**
   * Build the prompt with system message, context, and conversation
   */
  private buildPrompt(
    query: string,
    context: ContextChunk[],
    memories: string[],
    conversationHistory: ChatMessage[]
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    
    // System message with context
    let systemMessage = this.settings.systemPrompt;
    
    // Add tool descriptions if tool calling is enabled
    if (this.toolManager && this.settings.enableToolCalling) {
      systemMessage += '\n\n' + this.toolManager.getToolDescriptions();
    }
    
    // Add memories to system context
    if (memories.length > 0) {
      systemMessage += '\n\n## User Memories\n';
      systemMessage += 'Things you know about the user:\n';
      for (const memory of memories) {
        systemMessage += `- ${memory}\n`;
      }
    }
    
    // Add retrieved context
    if (context.length > 0) {
      systemMessage += '\n\n## Relevant Vault Context\n';
      systemMessage += 'Here are relevant excerpts from the user\'s notes:\n\n';
      
      let totalLength = 0;
      for (const chunk of context) {
        // Check context length limit
        if (totalLength + chunk.content.length > this.settings.ragMaxContextLength) {
          break;
        }
        
        systemMessage += `### From: ${this.formatPath(chunk.source)}\n`;
        systemMessage += chunk.content;
        systemMessage += '\n\n---\n\n';
        
        totalLength += chunk.content.length;
      }
    }
    
    messages.push({
      role: 'system',
      content: systemMessage,
    });
    
    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push(msg);
    }
    
    // Add current query
    messages.push({
      role: 'user',
      content: query,
    });
    
    return messages;
  }

  /**
   * Extract memories from the conversation
   */
  private async extractMemories(query: string, response: string): Promise<void> {
    if (!this.settings.enableMemory) return;
    
    // Use LLM to extract memories if the response contains personal information
    const combinedText = `${query}\n${response}`;
    
    // Check for memory extraction triggers
    const memoryPatterns = [
      /\b(I am|I'm|my name is|I work|I live|I prefer|I like|I don't like|I always|I never)\b/i,
      /\b(remember that|note that|keep in mind|don't forget)\b/i,
    ];
    
    const shouldExtract = memoryPatterns.some(p => p.test(combinedText));
    
    if (shouldExtract) {
      try {
        const extractionPrompt = `Extract any personal facts or preferences from this conversation that should be remembered for future interactions. Return ONLY a JSON array of short memory strings, or an empty array if none. Be very selective - only extract clear, factual information about the user.

Conversation:
User: ${query}
Assistant: ${response}

Response format: ["memory 1", "memory 2"] or []`;

        const extractionResponse = await this.providerManager.chat({
          messages: [
            { role: 'system', content: 'You are a memory extraction assistant. Extract personal facts as a JSON array.' },
            { role: 'user', content: extractionPrompt },
          ],
          temperature: 0.1,
          maxTokens: 200,
        });
        
        // Parse the response
        const match = extractionResponse.content.match(/\[[\s\S]*\]/);
        if (match) {
          const memories = JSON.parse(match[0]) as string[];
          for (const memory of memories) {
            await this.memoryManager.addMemory(memory);
          }
        }
      } catch (error) {
        // Log memory extraction failures for debugging
        console.warn('[Calcifer] Memory extraction failed:', error instanceof Error ? error.message : error);
      }
    }
  }

  /**
   * Format file path for display
   */
  private formatPath(path: string): string {
    return path.replace(/\.md$/, '');
  }

  /**
   * Search for specific information (non-chat query)
   */
  async search(query: string): Promise<SearchResult[]> {
    try {
      const embeddingResponse = await this.providerManager.embed({
        input: query,
        model: '',
      });
      
      if (embeddingResponse.embeddings.length === 0) {
        return [];
      }
      
      return this.vectorStore.search(
        embeddingResponse.embeddings[0],
        this.settings.ragTopK,
        this.settings.ragMinScore
      );
    } catch (error) {
      console.error('Search failed:', error);
      return [];
    }
  }

  /**
   * Find similar notes to a given file
   */
  async findSimilar(filePath: string, limit: number = 5): Promise<SearchResult[]> {
    try {
      // Get embeddings for the file
      const docs = await this.vectorStore.getByPath(filePath);
      if (docs.length === 0) return [];
      
      // Average the embeddings
      const avgEmbedding = this.averageEmbeddings(docs.map(d => d.embedding));
      
      // Search excluding the source file
      const results = await this.vectorStore.search(avgEmbedding, limit + 10, 0);
      
      return results
        .filter(r => r.document.path !== filePath)
        .slice(0, limit);
        
    } catch (error) {
      console.error('Find similar failed:', error);
      return [];
    }
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
