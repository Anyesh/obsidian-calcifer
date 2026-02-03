/**
 * Provider Manager
 * 
 * Manages multiple AI providers with priority-based fallback.
 * Tries providers in order until one succeeds.
 */

import { OllamaProvider } from './OllamaProvider';
import { OpenAIProvider } from './OpenAIProvider';
import {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  HealthCheckResult,
  ProviderError,
} from './types';
import type { CalciferSettings, EndpointConfig } from '@/settings';

/**
 * Provider status information
 */
export interface ProviderStatus {
  id: string;
  name: string;
  type: 'ollama' | 'openai';
  enabled: boolean;
  healthy: boolean;
  lastCheck?: Date;
  error?: string;
}

/**
 * Provider Manager
 * 
 * Handles provider instantiation, health checking, and failover.
 */
export class ProviderManager {
  private providers: Map<string, AIProvider> = new Map();
  private providerStatus: Map<string, ProviderStatus> = new Map();
  private settings: CalciferSettings;
  
  constructor(settings: CalciferSettings) {
    this.settings = settings;
    this.initializeProviders();
  }

  /**
   * Initialize providers from settings
   */
  private initializeProviders(): void {
    this.providers.clear();
    this.providerStatus.clear();
    
    for (const config of this.settings.endpoints) {
      if (!config.enabled) continue;
      
      try {
        const provider = this.createProvider(config);
        this.providers.set(config.id, provider);
        this.providerStatus.set(config.id, {
          id: config.id,
          name: config.name,
          type: config.type,
          enabled: config.enabled,
          healthy: true, // Assume healthy until checked
        });
      } catch (error) {
        console.error(`Failed to create provider ${config.name}:`, error);
      }
    }
  }

  /**
   * Create a provider instance from config
   */
  private createProvider(config: EndpointConfig): AIProvider {
    const timeoutMs = this.settings.requestTimeoutMs;
    const useNativeFetch = this.settings.useNativeFetch;
    
    switch (config.type) {
      case 'ollama':
        return new OllamaProvider(config, timeoutMs, useNativeFetch);
      case 'openai':
        return new OpenAIProvider(config, timeoutMs, useNativeFetch);
      default:
        throw new Error(`Unknown provider type: ${config.type}`);
    }
  }

  /**
   * Update settings and reinitialize providers
   */
  updateSettings(settings: CalciferSettings): void {
    this.settings = settings;
    this.initializeProviders();
  }

  /**
   * Get sorted list of providers by priority
   */
  private getSortedProviders(): AIProvider[] {
    const enabledConfigs = this.settings.endpoints
      .filter(e => e.enabled)
      .sort((a, b) => a.priority - b.priority);
    
    return enabledConfigs
      .map(config => this.providers.get(config.id))
      .filter((p): p is AIProvider => p !== undefined);
  }

  /**
   * Get status of all providers
   */
  getProviderStatuses(): ProviderStatus[] {
    return Array.from(this.providerStatus.values())
      .sort((a, b) => {
        const aConfig = this.settings.endpoints.find(e => e.id === a.id);
        const bConfig = this.settings.endpoints.find(e => e.id === b.id);
        return (aConfig?.priority ?? 999) - (bConfig?.priority ?? 999);
      });
  }

  /**
   * Get a provider by ID
   */
  getProviderById(id: string): AIProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Check health of all providers
   */
  async checkAllHealth(): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();
    
    const checks = Array.from(this.providers.entries()).map(
      async ([id, provider]) => {
        const result = await provider.healthCheck();
        results.set(id, result);
        
        // Update status
        const status = this.providerStatus.get(id);
        if (status) {
          status.healthy = result.healthy;
          status.lastCheck = new Date();
          status.error = result.error;
        }
      }
    );
    
    await Promise.all(checks);
    return results;
  }

  /**
   * Chat completion with priority-based fallback
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const providers = this.getSortedProviders();
    
    if (providers.length === 0) {
      throw new ProviderError(
        'No providers configured',
        'CONNECTION_FAILED',
        'ProviderManager'
      );
    }
    
    let lastError: Error | null = null;
    
    for (const provider of providers) {
      try {
        const response = await provider.chat(request);
        return response;
      } catch (error) {
        console.warn(`Provider ${provider.name} failed:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Update status
        const status = this.providerStatus.get(provider.id);
        if (status) {
          status.healthy = false;
          status.error = lastError.message;
        }
        
        // Continue to next provider
      }
    }
    
    throw new ProviderError(
      `All providers failed. Last error: ${lastError?.message}`,
      'CONNECTION_FAILED',
      'ProviderManager',
      lastError ?? undefined
    );
  }

  /**
   * Streaming chat with priority-based fallback
   */
  async chatStream(
    request: ChatRequest,
    onChunk: (chunk: ChatStreamChunk) => void
  ): Promise<ChatResponse> {
    const providers = this.getSortedProviders();
    
    if (providers.length === 0) {
      throw new ProviderError(
        'No providers configured',
        'CONNECTION_FAILED',
        'ProviderManager'
      );
    }
    
    let lastError: Error | null = null;
    
    for (const provider of providers) {
      try {
        const response = await provider.chatStream(request, onChunk);
        return response;
      } catch (error) {
        console.warn(`Provider ${provider.name} streaming failed:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Update status
        const status = this.providerStatus.get(provider.id);
        if (status) {
          status.healthy = false;
          status.error = lastError.message;
        }
      }
    }
    
    throw new ProviderError(
      `All providers failed. Last error: ${lastError?.message}`,
      'CONNECTION_FAILED',
      'ProviderManager',
      lastError ?? undefined
    );
  }

  /**
   * Generate embeddings with priority-based fallback
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const providers = this.getSortedProviders();
    
    if (providers.length === 0) {
      throw new ProviderError(
        'No providers configured',
        'CONNECTION_FAILED',
        'ProviderManager'
      );
    }
    
    let lastError: Error | null = null;
    
    for (const provider of providers) {
      try {
        const response = await provider.embed(request);
        return response;
      } catch (error) {
        console.warn(`Provider ${provider.name} embed failed:`, error);
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Update status
        const status = this.providerStatus.get(provider.id);
        if (status) {
          status.healthy = false;
          status.error = lastError.message;
        }
      }
    }
    
    throw new ProviderError(
      `All providers failed for embedding. Last error: ${lastError?.message}`,
      'CONNECTION_FAILED',
      'ProviderManager',
      lastError ?? undefined
    );
  }

  /**
   * List models from the first available provider
   */
  async listModels(): Promise<string[]> {
    const providers = this.getSortedProviders();
    
    if (providers.length === 0) {
      return [];
    }
    
    for (const provider of providers) {
      try {
        return await provider.listModels();
      } catch (error) {
        console.warn(`Provider ${provider.name} listModels failed:`, error);
        continue;
      }
    }
    
    return [];
  }

  /**
   * Get the currently active provider (highest priority healthy provider)
   */
  getActiveProvider(): AIProvider | null {
    const providers = this.getSortedProviders();
    
    for (const provider of providers) {
      const status = this.providerStatus.get(provider.id);
      if (status?.healthy) {
        return provider;
      }
    }
    
    // Return first provider even if unhealthy
    return providers[0] ?? null;
  }

  /**
   * Check if any provider is available
   */
  hasAvailableProvider(): boolean {
    return this.getSortedProviders().length > 0;
  }
}
