/**
 * AI Provider Types
 * 
 * Common interfaces for AI service providers (Ollama, OpenAI-compatible, etc.)
 */

/**
 * Chat message format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion request
 */
export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

/**
 * Chat completion response
 */
export interface ChatResponse {
  content: string;
  finishReason?: 'stop' | 'length' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Embedding request
 */
export interface EmbeddingRequest {
  /** Text or array of texts to embed */
  input: string | string[];
  /** Model to use for embedding */
  model: string;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  /** Array of embeddings (one per input text) */
  embeddings: number[][];
  /** Model used */
  model: string;
  /** Token usage information */
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Provider health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
  modelInfo?: {
    chatAvailable: boolean;
    embeddingAvailable: boolean;
    chatModel?: string;
    embeddingModel?: string;
  };
}

/**
 * Streaming chat chunk
 */
export interface ChatStreamChunk {
  content: string;
  done: boolean;
}

/**
 * Base interface for AI providers
 */
export interface AIProvider {
  /** Provider identifier */
  readonly id: string;
  /** Provider display name */
  readonly name: string;
  /** Provider type */
  readonly type: 'ollama' | 'openai';
  
  /**
   * Check if the provider is available and healthy
   */
  healthCheck(): Promise<HealthCheckResult>;
  
  /**
   * Generate chat completion
   */
  chat(request: ChatRequest): Promise<ChatResponse>;
  
  /**
   * Generate chat completion with streaming
   */
  chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse>;
  
  /**
   * Generate embeddings for text
   */
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
  
  /**
   * List available models
   */
  listModels(): Promise<string[]>;
}

/**
 * Error types for provider operations
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly provider: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export type ProviderErrorCode =
  | 'CONNECTION_FAILED'
  | 'AUTHENTICATION_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'INVALID_REQUEST'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

/**
 * Map HTTP status codes to error codes
 */
export function httpStatusToErrorCode(status: number): ProviderErrorCode {
  switch (status) {
    case 401:
    case 403:
      return 'AUTHENTICATION_FAILED';
    case 404:
      return 'MODEL_NOT_FOUND';
    case 429:
      return 'RATE_LIMITED';
    case 408:
      return 'TIMEOUT';
    case 400:
      return 'INVALID_REQUEST';
    default:
      if (status >= 500) return 'SERVER_ERROR';
      return 'UNKNOWN';
  }
}
