/**
 * Calcifer Plugin Settings
 * 
 * Defines all configurable options for the plugin.
 */

/**
 * Provider endpoint configuration
 */
export interface EndpointConfig {
  /** Unique identifier for this endpoint */
  id: string;
  /** Display name */
  name: string;
  /** Provider type: ollama or openai-compatible */
  type: 'ollama' | 'openai';
  /** Base URL for the API */
  baseUrl: string;
  /** API key (required for OpenAI, optional for Ollama) */
  apiKey?: string;
  /** Model name for chat completions */
  chatModel: string;
  /** Model name for embeddings */
  embeddingModel: string;
  /** Whether this endpoint is enabled */
  enabled: boolean;
  /** Priority order (lower = higher priority) */
  priority: number;
}

/**
 * Main settings interface
 */
export interface CalciferSettings {
  // === Endpoint Configuration ===
  /** List of configured API endpoints */
  endpoints: EndpointConfig[];
  
  // === Embedding Settings ===
  /** Enable automatic embedding on file changes */
  enableEmbedding: boolean;
  /** Maximum concurrent embedding requests */
  embeddingBatchSize: number;
  /** Debounce delay for file changes (ms) */
  embeddingDebounceMs: number;
  /** Chunk size for text splitting (characters) */
  chunkSize: number;
  /** Chunk overlap (characters) */
  chunkOverlap: number;
  /** Files/folders to exclude from embedding (glob patterns) */
  embeddingExclude: string[];
  
  // === RAG Settings ===
  /** Number of context chunks to retrieve */
  ragTopK: number;
  /** Minimum similarity score for context (0-1) */
  ragMinScore: number;
  /** Include frontmatter in context */
  ragIncludeFrontmatter: boolean;
  /** Maximum total context length (characters) */
  ragMaxContextLength: number;
  
  // === Chat Settings ===
  /** System prompt for the assistant */
  systemPrompt: string;
  /** Include chat history in context */
  includeChatHistory: boolean;
  /** Maximum chat history messages to include */
  maxHistoryMessages: number;
  /** Temperature for chat completions */
  chatTemperature: number;
  /** Max tokens for response */
  chatMaxTokens: number;
  
  // === Tool Calling Settings ===
  /** Enable tool calling for vault operations (create folders, move notes, etc.) */
  enableToolCalling: boolean;
  /** Require confirmation before executing destructive tools (delete, overwrite) */
  requireToolConfirmation: boolean;
  
  // === Memory Settings ===
  /** Enable persistent memory system */
  enableMemory: boolean;
  /** Maximum number of memories to store */
  maxMemories: number;
  /** Include memories in chat context */
  includeMemoriesInContext: boolean;
  
  // === Auto-Tagging Settings ===
  /** Enable auto-tagging feature */
  enableAutoTag: boolean;
  /** Auto-apply tags or suggest only */
  autoTagMode: 'auto' | 'suggest';
  /** Maximum tags to suggest per note */
  maxTagSuggestions: number;
  /** Use existing vault tags as reference */
  useExistingTags: boolean;
  /** Confidence threshold for auto-apply (0-1) */
  autoTagConfidence: number;
  
  // === Organization Settings ===
  /** Enable auto-organization suggestions */
  enableAutoOrganize: boolean;
  /** Auto-move files or suggest only */
  autoOrganizeMode: 'auto' | 'suggest';
  /** Confidence threshold for auto-move (0-1) */
  autoOrganizeConfidence: number;
  
  // === UI Settings ===
  /** Show context sources in chat */
  showContextSources: boolean;
  /** Show indexing progress notifications */
  showIndexingProgress: boolean;
  
  // === Performance Settings ===
  /** Enable on mobile devices */
  enableOnMobile: boolean;
  /** Rate limit: max requests per minute */
  rateLimitRpm: number;
  /** Request timeout (ms) */
  requestTimeoutMs: number;
  /** Use native fetch instead of Obsidian's requestUrl (for internal CAs) */
  useNativeFetch: boolean;
}

/**
 * Default settings values
 */
export const DEFAULT_SETTINGS: CalciferSettings = {
  // Endpoints - empty by default, user must configure
  endpoints: [],
  
  // Embedding - DISABLED by default until provider is configured and tested
  enableEmbedding: false,
  embeddingBatchSize: 1,
  embeddingDebounceMs: 5000,
  chunkSize: 1000,
  chunkOverlap: 200,
  embeddingExclude: [
    'templates/**',
    '.obsidian/**',
  ],
  
  // RAG
  ragTopK: 5,
  ragMinScore: 0.5,
  ragIncludeFrontmatter: true,
  ragMaxContextLength: 8000,
  
  // Chat
  systemPrompt: `You are Calcifer, a helpful AI assistant integrated into Obsidian.

You can help users with:
- Answering questions about their vault content
- Finding connections between notes  
- Performing vault operations (creating folders, moving notes, renaming, deleting, etc.)
- General knowledge assistance

When relevant context from the vault is available, use it to provide accurate answers.
Be concise but thorough. Format responses in Markdown when helpful.

⚠️ CRITICAL RULE FOR ACTIONS:
When the user asks you to DO something (create, move, delete, rename, organize, etc.):
- You MUST use the tool system by including a \`\`\`tool code block
- NEVER just say "I've done it" - that's a LIE if you don't include a tool block
- The tool block is what actually executes the action
- Without a tool block, NOTHING happens in the vault

Example of CORRECT behavior:
User: "Create an Inbox folder and move my Welcome note there"
You respond with tool blocks:
\`\`\`tool
{"tool": "create_folder", "arguments": {"path": "Inbox"}}
\`\`\`
\`\`\`tool
{"tool": "move_note", "arguments": {"sourcePath": "Welcome", "destinationFolder": "Inbox"}}
\`\`\``,
  includeChatHistory: true,
  maxHistoryMessages: 10,
  chatTemperature: 0.7,
  chatMaxTokens: 2048,
  
  // Tool Calling
  enableToolCalling: true,
  requireToolConfirmation: false,
  
  // Memory
  enableMemory: true,
  maxMemories: 100,
  includeMemoriesInContext: true,
  
  // Auto-tagging
  enableAutoTag: true,
  autoTagMode: 'auto',
  maxTagSuggestions: 5,
  useExistingTags: true,
  autoTagConfidence: 0.8,
  
  // Organization
  enableAutoOrganize: true,
  autoOrganizeMode: 'suggest',
  autoOrganizeConfidence: 0.9,
  
  // UI
  showContextSources: true,
  showIndexingProgress: true,
  
  // Performance
  enableOnMobile: true,
  rateLimitRpm: 60,
  requestTimeoutMs: 120000,
  useNativeFetch: false,
};

/**
 * Validate settings and return any errors
 */
export function validateSettings(settings: CalciferSettings): string[] {
  const errors: string[] = [];
  
  // Validate endpoints
  if (settings.endpoints.length === 0) {
    errors.push('At least one API endpoint must be configured');
  }
  
  for (const endpoint of settings.endpoints) {
    if (!endpoint.baseUrl) {
      errors.push(`Endpoint "${endpoint.name}": Base URL is required`);
    } else if (!isValidUrl(endpoint.baseUrl)) {
      errors.push(`Endpoint "${endpoint.name}": Base URL is not a valid URL`);
    }
    if (!endpoint.chatModel || endpoint.chatModel.trim() === '') {
      errors.push(`Endpoint "${endpoint.name}": Chat model is required`);
    }
    if (!endpoint.embeddingModel || endpoint.embeddingModel.trim() === '') {
      errors.push(`Endpoint "${endpoint.name}": Embedding model is required`);
    }
    if (endpoint.type === 'openai' && !endpoint.apiKey) {
      errors.push(`Endpoint "${endpoint.name}": API key is required for OpenAI`);
    }
  }
  
  // Validate numeric ranges
  if (!Number.isFinite(settings.chunkSize) || settings.chunkSize < 100 || settings.chunkSize > 10000) {
    errors.push('Chunk size must be between 100 and 10000');
  }
  if (!Number.isFinite(settings.chunkOverlap) || settings.chunkOverlap < 0 || settings.chunkOverlap >= settings.chunkSize) {
    errors.push('Chunk overlap must be between 0 and less than chunk size');
  }
  if (!Number.isFinite(settings.ragTopK) || settings.ragTopK < 1 || settings.ragTopK > 20) {
    errors.push('RAG top K must be between 1 and 20');
  }
  if (!Number.isFinite(settings.ragMinScore) || settings.ragMinScore < 0 || settings.ragMinScore > 1) {
    errors.push('RAG min score must be between 0 and 1');
  }
  if (!Number.isFinite(settings.chatTemperature) || settings.chatTemperature < 0 || settings.chatTemperature > 2) {
    errors.push('Chat temperature must be between 0 and 2');
  }
  if (!Number.isFinite(settings.rateLimitRpm) || settings.rateLimitRpm < 1 || settings.rateLimitRpm > 1000) {
    errors.push('Rate limit must be between 1 and 1000 RPM');
  }
  if (!Number.isFinite(settings.requestTimeoutMs) || settings.requestTimeoutMs < 5000 || settings.requestTimeoutMs > 300000) {
    errors.push('Request timeout must be between 5 and 300 seconds');
  }
  
  return errors;
}

/**
 * Validate a URL string
 */
function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitize endpoint config to ensure valid values
 */
export function sanitizeEndpointConfig(config: Partial<EndpointConfig>): EndpointConfig {
  return {
    id: config.id || generateEndpointId(),
    name: (config.name || 'Unnamed').trim().slice(0, 50),
    type: config.type === 'openai' ? 'openai' : 'ollama',
    baseUrl: (config.baseUrl || '').trim(),
    apiKey: config.apiKey?.trim() || '',
    chatModel: (config.chatModel || '').trim(),
    embeddingModel: (config.embeddingModel || '').trim(),
    enabled: config.enabled ?? true,
    priority: Math.max(0, Math.floor(config.priority || 0)),
  };
}

/**
 * Get the active endpoint based on priority
 */
export function getActiveEndpoint(settings: CalciferSettings): EndpointConfig | null {
  const enabled = settings.endpoints
    .filter(e => e.enabled)
    .sort((a, b) => a.priority - b.priority);
  
  return enabled.length > 0 ? enabled[0] : null;
}

/**
 * Generate a unique endpoint ID
 */
export function generateEndpointId(): string {
  return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
