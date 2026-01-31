/**
 * Ollama API Provider
 * 
 * Implements AIProvider interface for Ollama API endpoints.
 * Reference: https://github.com/ollama/ollama/blob/main/docs/api.md
 */

import { requestUrl, RequestUrlParam } from 'obsidian';
import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthCheckResult,
  ProviderError,
  httpStatusToErrorCode,
} from './types';
import type { EndpointConfig } from '@/settings';

/**
 * Ollama API response types
 */
interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  done_reason?: string;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Ollama API Provider implementation
 */
export class OllamaProvider implements AIProvider {
  readonly id: string;
  readonly name: string;
  readonly type = 'ollama' as const;
  
  private baseUrl: string;
  private chatModel: string;
  private embeddingModel: string;
  private timeoutMs: number;

  constructor(config: EndpointConfig, timeoutMs: number = 30000) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Health check - verify connection and model availability
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Try to list models to verify connection
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;
      
      const chatAvailable = models.some(m => 
        m.toLowerCase().includes(this.chatModel.toLowerCase())
      );
      const embeddingAvailable = models.some(m => 
        m.toLowerCase().includes(this.embeddingModel.toLowerCase())
      );
      
      return {
        healthy: true,
        latencyMs,
        modelInfo: {
          chatAvailable,
          embeddingAvailable,
          chatModel: this.chatModel,
          embeddingModel: this.embeddingModel,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Chat completion using /api/chat endpoint
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/api/chat`;
    
    const body = {
      model: this.chatModel,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 2048,
      },
    };

    try {
      const response = await this.request<OllamaChatResponse>(url, body);
      
      return {
        content: response.message.content,
        finishReason: response.done_reason === 'stop' ? 'stop' : 
                      response.done_reason === 'length' ? 'length' : 'stop',
        usage: {
          promptTokens: response.prompt_eval_count ?? 0,
          completionTokens: response.eval_count ?? 0,
          totalTokens: (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0),
        },
      };
    } catch (error) {
      throw this.wrapError(error, 'chat');
    }
  }

  /**
   * Streaming chat completion
   * Note: Obsidian's requestUrl doesn't support streaming directly,
   * so we simulate it with non-streaming for now.
   * TODO: Implement proper streaming with fetch API where available
   */
  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse> {
    // For now, fall back to non-streaming and emit single chunk
    const response = await this.chat(request);
    
    onChunk({
      content: response.content,
      done: true,
    });
    
    return response;
  }

  /**
   * Generate embeddings using /api/embed endpoint
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const url = `${this.baseUrl}/api/embed`;
    
    // Ollama's /api/embed accepts single string or array
    const input = Array.isArray(request.input) ? request.input : [request.input];
    
    const body = {
      model: request.model || this.embeddingModel,
      input: input,
    };

    try {
      const response = await this.request<OllamaEmbedResponse>(url, body);
      
      return {
        embeddings: response.embeddings,
        model: response.model,
        usage: {
          promptTokens: response.prompt_eval_count ?? 0,
          totalTokens: response.prompt_eval_count ?? 0,
        },
      };
    } catch (error) {
      throw this.wrapError(error, 'embed');
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<string[]> {
    const url = `${this.baseUrl}/api/tags`;
    
    try {
      const params: RequestUrlParam = {
        url,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      };
      
      const response = await requestUrl(params);
      const data = response.json as OllamaTagsResponse;
      
      return data.models.map(m => m.name);
    } catch (error) {
      throw this.wrapError(error, 'listModels');
    }
  }

  /**
   * Make an HTTP request with proper error handling
   */
  private async request<T>(url: string, body: unknown): Promise<T> {
    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };

    const response = await requestUrl(params);
    
    if (response.status >= 400) {
      throw new ProviderError(
        `Request failed with status ${response.status}`,
        httpStatusToErrorCode(response.status),
        this.name
      );
    }
    
    return response.json as T;
  }

  /**
   * Wrap errors in ProviderError
   */
  private wrapError(error: unknown, operation: string): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    
    // Check for common error patterns
    if (message.includes('net::ERR') || message.includes('fetch')) {
      return new ProviderError(
        `Connection failed to ${this.baseUrl}`,
        'CONNECTION_FAILED',
        this.name,
        error instanceof Error ? error : undefined
      );
    }
    
    if (message.includes('timeout')) {
      return new ProviderError(
        `Request timed out during ${operation}`,
        'TIMEOUT',
        this.name,
        error instanceof Error ? error : undefined
      );
    }
    
    return new ProviderError(
      `${operation} failed: ${message}`,
      'UNKNOWN',
      this.name,
      error instanceof Error ? error : undefined
    );
  }
}
