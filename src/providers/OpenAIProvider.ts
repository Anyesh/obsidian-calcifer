/**
 * OpenAI-Compatible API Provider
 * 
 * Implements AIProvider interface for OpenAI-compatible endpoints.
 * Works with OpenAI, Azure OpenAI, and other compatible APIs.
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
 * OpenAI API response types
 */
interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIEmbeddingResponse {
  object: string;
  data: Array<{
    object: string;
    index: number;
    embedding: number[];
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModelsResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    owned_by: string;
  }>;
}

interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * OpenAI-Compatible API Provider implementation
 */
export class OpenAIProvider implements AIProvider {
  readonly id: string;
  readonly name: string;
  readonly type = 'openai' as const;
  
  private baseUrl: string;
  private apiKey: string;
  private chatModel: string;
  private embeddingModel: string;
  private timeoutMs: number;
  private useNativeFetch: boolean;

  constructor(config: EndpointConfig, timeoutMs: number = 30000, useNativeFetch: boolean = false) {
    this.id = config.id;
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = config.apiKey || '';
    this.chatModel = config.chatModel;
    this.embeddingModel = config.embeddingModel;
    this.timeoutMs = timeoutMs;
    this.useNativeFetch = useNativeFetch;
  }

  /**
   * Health check - verify connection and authentication
   */
  async healthCheck(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Try to list models to verify connection and auth
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;
      
      // Check if configured models are available
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
   * Chat completion using /v1/chat/completions endpoint
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    
    const body = {
      model: this.chatModel,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream: false,
    };

    try {
      const response = await this.request<OpenAIChatResponse>(url, body);
      
      if (!response.choices || response.choices.length === 0) {
        throw new ProviderError(
          'No choices in response',
          'SERVER_ERROR',
          this.name
        );
      }
      
      const choice = response.choices[0];
      
      return {
        content: choice.message.content,
        finishReason: choice.finish_reason === 'stop' ? 'stop' : 
                      choice.finish_reason === 'length' ? 'length' : 'stop',
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        },
      };
    } catch (error) {
      throw this.wrapError(error, 'chat');
    }
  }

  /**
   * Streaming chat completion
   * Uses native fetch API for streaming support
   */
  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse> {
    // Use streaming when native fetch is enabled
    if (this.useNativeFetch) {
      return this.streamWithFetch(request, onChunk);
    }
    
    // Fall back to non-streaming with single chunk emission
    const response = await this.chat(request);
    
    onChunk({
      content: response.content,
      done: true,
    });
    
    return response;
  }

  /**
   * Stream chat completion using fetch API
   */
  private async streamWithFetch(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    
    const body = {
      model: this.chatModel,
      messages: request.messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
      stream: true,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        this.handleErrorResponse(response.status, errorBody);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('Response body is not readable', 'UNKNOWN', this.name);
      }

      const decoder = new TextDecoder();
      let fullContent = '';
      let buffer = '';

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
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            
            if (data === '[DONE]') {
              onChunk({ content: '', done: true });
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              
              if (delta) {
                fullContent += delta;
                onChunk({ content: delta, done: false });
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }
      }

      return {
        content: fullContent,
        finishReason: 'stop',
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
   * Generate embeddings using /v1/embeddings endpoint
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const url = `${this.baseUrl}/v1/embeddings`;
    
    const body = {
      model: request.model || this.embeddingModel,
      input: request.input,
    };

    try {
      const response = await this.request<OpenAIEmbeddingResponse>(url, body);
      
      // Sort by index to ensure correct order
      const sortedData = [...response.data].sort((a, b) => a.index - b.index);
      
      return {
        embeddings: sortedData.map(d => d.embedding),
        model: response.model,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          totalTokens: response.usage.total_tokens,
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
    const url = `${this.baseUrl}/v1/models`;
    
    try {
      // Use native fetch for better SSL certificate handling with internal CAs
      if (this.useNativeFetch) {
        const data = await this.requestWithFetch<OpenAIModelsResponse>(url, 'GET');
        return data.data.map(m => m.id);
      }

      const params: RequestUrlParam = {
        url,
        method: 'GET',
        headers: this.getHeaders(),
        throw: false, // Handle errors manually for better error messages
      };
      
      let response;
      try {
        response = await requestUrl(params);
      } catch (error) {
        // Log detailed error for debugging
        console.error('[Calcifer] listModels request failed:', {
          url,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error;
      }
      
      if (response.status >= 400) {
        this.handleErrorResponse(response.status, response.json);
      }
      
      const data = response.json as OpenAIModelsResponse;
      return data.data.map(m => m.id);
    } catch (error) {
      throw this.wrapError(error, 'listModels');
    }
  }

  /**
   * Get request headers with authentication
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    
    return headers;
  }

  /**
   * Make an HTTP request with proper error handling and timeout
   */
  private async request<T>(url: string, body: unknown): Promise<T> {
    // Use native fetch for better SSL certificate handling with internal CAs
    if (this.useNativeFetch) {
      return this.requestWithFetch<T>(url, 'POST', body);
    }

    // Wrap requestUrl with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });

    const params: RequestUrlParam = {
      url,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
      contentType: 'application/json',
      throw: false, // Handle errors manually for better error messages
    };

    let response;
    try {
      response = await Promise.race([requestUrl(params), timeoutPromise]);
    } catch (error) {
      // Log detailed error for debugging
      console.error('[Calcifer] Request failed:', {
        url,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
    
    if (response.status >= 400) {
      this.handleErrorResponse(response.status, response.json);
    }
    
    return response.json as T;
  }

  /**
   * Make request using native fetch API
   */
  private async requestWithFetch<T>(url: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const options: RequestInit = {
        method,
        headers: this.getHeaders(),
        signal: controller.signal,
      };

      if (body && method === 'POST') {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      
      if (response.status >= 400) {
        const errorBody = await response.json().catch(() => ({}));
        this.handleErrorResponse(response.status, errorBody);
      }

      return await response.json() as T;
    } catch (error) {
      console.error('[Calcifer] Fetch request failed:', {
        url,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle error responses from the API
   */
  private handleErrorResponse(status: number, body: unknown): never {
    let message = `Request failed with status ${status}`;
    
    // Try to extract error message from response
    if (body && typeof body === 'object' && 'error' in body) {
      const errorBody = body as OpenAIErrorResponse;
      message = errorBody.error.message || message;
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
    
    if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
      return new ProviderError(
        'Authentication failed - check your API key',
        'AUTHENTICATION_FAILED',
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
