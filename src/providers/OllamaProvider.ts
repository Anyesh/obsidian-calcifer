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
  private useNativeFetch: boolean;

  constructor(config: EndpointConfig, timeoutMs: number = 30000, useNativeFetch: boolean = false) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;
    this.timeoutMs = timeoutMs;
    this.useNativeFetch = useNativeFetch;
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
   * Uses native fetch API to parse Ollama's NDJSON stream
   * 
   * NOTE: We use native fetch here instead of requestUrl because:
   * - requestUrl doesn't support ReadableStream for incremental streaming
   * - Streaming is essential for UX to show tokens as they arrive
   * - Falls back to non-streaming if fetch is unavailable (mobile)
   */
  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse> {
    // Ollama is typically local, so we can use fetch
    // For mobile/restricted environments, fall back to non-streaming
    if (typeof fetch === 'undefined') {
      const response = await this.chat(request);
      onChunk({ content: response.content, done: true });
      return response;
    }

    const url = `${this.baseUrl}/api/chat`;
    
    const body = {
      model: this.chatModel,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxTokens ?? 2048,
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => ({}));
        this.handleErrorResponse(response.status, errorBody);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('Response body is not readable', 'UNKNOWN', this.name);
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let finishReason: 'stop' | 'length' = 'stop';

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        
        if (done) {
          onChunk({ content: '', done: true });
          streamDone = true;
          continue;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsed = JSON.parse(line) as OllamaChatResponse;
            
            if (parsed.message?.content) {
              fullContent += parsed.message.content;
              onChunk({ content: parsed.message.content, done: false });
            }

            // Capture usage from final message
            if (parsed.done) {
              usage = {
                promptTokens: parsed.prompt_eval_count ?? 0,
                completionTokens: parsed.eval_count ?? 0,
                totalTokens: (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0),
              };
              finishReason = parsed.done_reason === 'length' ? 'length' : 'stop';
              onChunk({ content: '', done: true });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      return {
        content: fullContent,
        finishReason,
        usage,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderError('Request timed out', 'TIMEOUT', this.name);
      }
      throw this.wrapError(error, 'chatStream');
    } finally {
      clearTimeout(timeoutId);
    }
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
      if (this.useNativeFetch) {
        const data = await this.requestWithFetch<OllamaTagsResponse>(url, 'GET');
        return data.models.map(m => m.name);
      }

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
   * Make an HTTP request with proper error handling and timeout
   */
  private async request<T>(url: string, body: unknown): Promise<T> {
    if (this.useNativeFetch) {
      return this.requestWithFetch<T>(url, 'POST', body);
    }
    
    // Wrap requestUrl with timeout that can be cleared
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    };

    try {
      const response = await Promise.race([requestUrl(params), timeoutPromise]);
      
      if (response.status >= 400) {
        throw new ProviderError(
          `Request failed with status ${response.status}`,
          httpStatusToErrorCode(response.status),
          this.name
        );
      }
      
      return response.json as T;
    } finally {
      // Always clear the timeout to prevent phantom log messages
      clearTimeout(timeoutId!);
    }
  }

  /**
   * Make request using native fetch API
   * NOTE: Used when requestUrl fails (self-signed certs, etc.)
   */
  private async requestWithFetch<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const options: RequestInit = {
        method,
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      };

      if (body && method === 'POST') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      
      if (response.status >= 400) {
        throw new ProviderError(
          `Request failed with status ${response.status}`,
          httpStatusToErrorCode(response.status),
          this.name
        );
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle HTTP error responses
   */
  private handleErrorResponse(status: number, body: unknown): never {
    let message = `Request failed with status ${status}`;
    
    // Try to extract error message from Ollama's response
    if (body && typeof body === 'object' && 'error' in body) {
      message = (body as { error: string }).error || message;
    }
    
    throw new ProviderError(
      message,
      httpStatusToErrorCode(status),
      this.name
    );
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
