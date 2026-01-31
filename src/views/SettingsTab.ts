/**
 * Settings Tab UI
 * 
 * Provides the settings interface for Calcifer plugin configuration.
 */

import { App, PluginSettingTab, Setting, Notice, TextComponent, DropdownComponent } from 'obsidian';
import type CalciferPlugin from '@/../main';
import { 
  CalciferSettings, 
  EndpointConfig, 
  generateEndpointId,
  validateSettings 
} from '@/settings';
import { MemoryModal } from './MemoryModal';

/**
 * Calcifer Settings Tab
 */
export class CalciferSettingsTab extends PluginSettingTab {
  plugin: CalciferPlugin;
  private endpointContainer: HTMLElement | null = null;

  constructor(app: App, plugin: CalciferPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Create a validated numeric input with visual feedback
   */
  private createNumericSetting(
    containerEl: HTMLElement,
    name: string,
    desc: string,
    currentValue: number,
    options: {
      min?: number;
      max?: number;
      step?: number;
      placeholder?: string;
    },
    onValidChange: (value: number) => Promise<void>
  ): Setting {
    const { min = 0, max = Infinity, placeholder = '' } = options;
    
    return new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText(text => {
        text
          .setValue(String(currentValue))
          .setPlaceholder(placeholder)
          .onChange(async (value) => {
            const num = parseInt(value, 10);
            const inputEl = text.inputEl;
            
            if (isNaN(num) || num < min || num > max) {
              inputEl.addClass('calcifer-input-error');
              inputEl.setAttribute('aria-invalid', 'true');
              return;
            }
            
            inputEl.removeClass('calcifer-input-error');
            inputEl.removeAttribute('aria-invalid');
            await onValidChange(num);
          });
        
        // Add number type hint
        text.inputEl.setAttribute('inputmode', 'numeric');
        text.inputEl.setAttribute('pattern', '[0-9]*');
        
        return text;
      });
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('calcifer-settings');

    containerEl.createEl('h1', { text: 'Calcifer Settings' });

    // Endpoint Configuration Section
    this.renderEndpointSection(containerEl);

    // Embedding Settings Section
    this.renderEmbeddingSection(containerEl);

    // RAG Settings Section
    this.renderRAGSection(containerEl);

    // Chat Settings Section
    this.renderChatSection(containerEl);

    // Tool Calling Settings Section
    this.renderToolCallingSection(containerEl);

    // Memory Settings Section
    this.renderMemorySection(containerEl);

    // Auto-Tagging Settings Section
    this.renderAutoTagSection(containerEl);

    // Organization Settings Section
    this.renderOrganizationSection(containerEl);

    // UI Settings Section
    this.renderUISection(containerEl);

    // Performance Settings Section
    this.renderPerformanceSection(containerEl);

    // Validate and show warnings
    this.validateAndShowWarnings(containerEl);
  }

  /**
   * Render endpoint configuration section
   */
  private renderEndpointSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'API Endpoints' });
    containerEl.createEl('p', { 
      text: 'Configure AI provider endpoints. Endpoints are tried in priority order.',
      cls: 'setting-item-description'
    });

    // Add endpoint button
    new Setting(containerEl)
      .setName('Add Endpoint')
      .setDesc('Add a new API endpoint configuration')
      .addButton(button => button
        .setButtonText('Add Ollama')
        .onClick(() => this.addEndpoint('ollama'))
      )
      .addButton(button => button
        .setButtonText('Add OpenAI')
        .onClick(() => this.addEndpoint('openai'))
      );

    // Endpoint list container
    this.endpointContainer = containerEl.createDiv({ cls: 'calcifer-endpoint-list' });
    this.renderEndpoints();
  }

  /**
   * Render the list of configured endpoints
   */
  private renderEndpoints(): void {
    if (!this.endpointContainer) return;
    this.endpointContainer.empty();

    const endpoints = this.plugin.settings.endpoints
      .sort((a, b) => a.priority - b.priority);

    if (endpoints.length === 0) {
      this.endpointContainer.createEl('p', {
        text: 'No endpoints configured. Add an endpoint to get started.',
        cls: 'setting-item-description'
      });
      return;
    }

    for (const endpoint of endpoints) {
      this.renderEndpointItem(this.endpointContainer, endpoint);
    }
  }

  /**
   * Render a single endpoint configuration item
   */
  private renderEndpointItem(container: HTMLElement, endpoint: EndpointConfig): void {
    const item = container.createDiv({ cls: 'calcifer-endpoint-item' });
    
    // Header with name and controls
    const header = item.createDiv({ cls: 'calcifer-endpoint-header' });
    
    // Name input
    const nameInput = header.createEl('input', {
      type: 'text',
      value: endpoint.name,
      placeholder: 'Endpoint name'
    });
    nameInput.addEventListener('change', async () => {
      endpoint.name = nameInput.value;
      await this.plugin.saveSettings();
    });

    // Type badge
    header.createEl('span', {
      text: endpoint.type.toUpperCase(),
      cls: `calcifer-endpoint-badge calcifer-endpoint-badge--${endpoint.type}`
    });

    // Priority controls
    const priorityControls = header.createDiv({ cls: 'calcifer-endpoint-priority' });
    
    const upButton = priorityControls.createEl('button', { text: '↑' });
    upButton.addEventListener('click', () => this.moveEndpoint(endpoint.id, -1));
    
    const downButton = priorityControls.createEl('button', { text: '↓' });
    downButton.addEventListener('click', () => this.moveEndpoint(endpoint.id, 1));

    // Settings
    const settings = item.createDiv({ cls: 'calcifer-endpoint-settings' });

    // Base URL
    new Setting(settings)
      .setName('Base URL')
      .setDesc(endpoint.type === 'ollama' ? 
        'Ollama API URL (e.g., http://localhost:11434)' :
        'OpenAI-compatible API URL')
      .addText(text => text
        .setPlaceholder('http://localhost:11434')
        .setValue(endpoint.baseUrl)
        .onChange(async (value) => {
          endpoint.baseUrl = value;
          await this.plugin.saveSettings();
        })
      );

    // API Key (OpenAI only)
    if (endpoint.type === 'openai') {
      new Setting(settings)
        .setName('API Key')
        .setDesc('Your API key for authentication')
        .addText(text => text
          .setPlaceholder('sk-...')
          .setValue(endpoint.apiKey || '')
          .onChange(async (value) => {
            endpoint.apiKey = value;
            await this.plugin.saveSettings();
          })
        );
    }

    // Chat Model
    new Setting(settings)
      .setName('Chat Model')
      .setDesc('Model to use for chat completions')
      .addText(text => text
        .setPlaceholder(endpoint.type === 'ollama' ? 'llama3.2' : 'gpt-4o-mini')
        .setValue(endpoint.chatModel)
        .onChange(async (value) => {
          endpoint.chatModel = value;
          await this.plugin.saveSettings();
        })
      );

    // Embedding Model
    new Setting(settings)
      .setName('Embedding Model')
      .setDesc('Model to use for generating embeddings')
      .addText(text => text
        .setPlaceholder(endpoint.type === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small')
        .setValue(endpoint.embeddingModel)
        .onChange(async (value) => {
          endpoint.embeddingModel = value;
          await this.plugin.saveSettings();
        })
      );

    // Enable/Disable toggle
    new Setting(settings)
      .setName('Enabled')
      .setDesc('Enable or disable this endpoint')
      .addToggle(toggle => toggle
        .setValue(endpoint.enabled)
        .onChange(async (value) => {
          endpoint.enabled = value;
          await this.plugin.saveSettings();
        })
      );

    // Test connection button
    new Setting(settings)
      .setName('Test Connection')
      .setDesc('Verify the endpoint is reachable')
      .addButton(button => button
        .setButtonText('Test')
        .onClick(async () => {
          button.setButtonText('Testing...');
          button.setDisabled(true);
          
          try {
            const health = await this.plugin.providerManager.checkAllHealth();
            const result = health.get(endpoint.id);
            
            if (result?.healthy) {
              new Notice(`✓ Connection successful (${result.latencyMs}ms)`);
            } else {
              new Notice(`✗ Connection failed: ${result?.error || 'Unknown error'}`);
            }
          } catch (error) {
            new Notice(`✗ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          
          button.setButtonText('Test');
          button.setDisabled(false);
        })
      );

    // Delete button
    new Setting(settings)
      .setName('Delete Endpoint')
      .setDesc('Remove this endpoint configuration')
      .addButton(button => button
        .setButtonText('Delete')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.endpoints = this.plugin.settings.endpoints
            .filter(e => e.id !== endpoint.id);
          await this.plugin.saveSettings();
          this.renderEndpoints();
        })
      );
  }

  /**
   * Add a new endpoint configuration
   */
  private async addEndpoint(type: 'ollama' | 'openai'): Promise<void> {
    const newEndpoint: EndpointConfig = {
      id: generateEndpointId(),
      name: type === 'ollama' ? 'Ollama' : 'OpenAI',
      type,
      baseUrl: type === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com',
      apiKey: '',
      chatModel: type === 'ollama' ? 'llama3.2' : 'gpt-4o-mini',
      embeddingModel: type === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small',
      enabled: true,
      priority: this.plugin.settings.endpoints.length,
    };

    this.plugin.settings.endpoints.push(newEndpoint);
    await this.plugin.saveSettings();
    this.renderEndpoints();
  }

  /**
   * Move an endpoint up or down in priority
   */
  private async moveEndpoint(id: string, direction: number): Promise<void> {
    const endpoints = [...this.plugin.settings.endpoints]
      .sort((a, b) => a.priority - b.priority);
    
    const index = endpoints.findIndex(e => e.id === id);
    if (index === -1) return;
    
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= endpoints.length) return;
    
    // Swap priorities
    const temp = endpoints[index].priority;
    endpoints[index].priority = endpoints[newIndex].priority;
    endpoints[newIndex].priority = temp;
    
    await this.plugin.saveSettings();
    this.renderEndpoints();
  }

  /**
   * Render embedding settings section
   */
  private renderEmbeddingSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Embedding Settings' });

    new Setting(containerEl)
      .setName('Enable Embedding')
      .setDesc('Automatically generate embeddings for vault files')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableEmbedding)
        .onChange(async (value) => {
          this.plugin.settings.enableEmbedding = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Batch Size')
      .setDesc('Maximum concurrent embedding requests')
      .addSlider(slider => slider
        .setLimits(1, 50, 1)
        .setValue(this.plugin.settings.embeddingBatchSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.embeddingBatchSize = value;
          await this.plugin.saveSettings();
        })
      );

    this.createNumericSetting(
      containerEl,
      'Chunk Size',
      'Characters per text chunk for embedding (100-10000)',
      this.plugin.settings.chunkSize,
      { min: 100, max: 10000, placeholder: '1000' },
      async (value) => {
        this.plugin.settings.chunkSize = value;
        await this.plugin.saveSettings();
      }
    );

    this.createNumericSetting(
      containerEl,
      'Chunk Overlap',
      'Overlap between chunks to maintain context (0+)',
      this.plugin.settings.chunkOverlap,
      { min: 0, max: 1000, placeholder: '200' },
      async (value) => {
        this.plugin.settings.chunkOverlap = value;
        await this.plugin.saveSettings();
      }
    );

    new Setting(containerEl)
      .setName('Exclude Patterns')
      .setDesc('Glob patterns to exclude from embedding (one per line)')
      .addTextArea(text => text
        .setValue(this.plugin.settings.embeddingExclude.join('\n'))
        .onChange(async (value) => {
          this.plugin.settings.embeddingExclude = value
            .split('\n')
            .map(s => s.trim())
            .filter(s => s.length > 0);
          await this.plugin.saveSettings();
        })
      );
  }

  /**
   * Render RAG settings section
   */
  private renderRAGSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'RAG Settings' });

    new Setting(containerEl)
      .setName('Top K Results')
      .setDesc('Number of context chunks to retrieve')
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.ragTopK)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.ragTopK = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Minimum Score')
      .setDesc('Minimum similarity score for context inclusion (0-1)')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.ragMinScore)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.ragMinScore = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Include Frontmatter')
      .setDesc('Include file frontmatter in context')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.ragIncludeFrontmatter)
        .onChange(async (value) => {
          this.plugin.settings.ragIncludeFrontmatter = value;
          await this.plugin.saveSettings();
        })
      );

    this.createNumericSetting(
      containerEl,
      'Max Context Length',
      'Maximum total context length in characters (1000+)',
      this.plugin.settings.ragMaxContextLength,
      { min: 1000, max: 100000, placeholder: '8000' },
      async (value) => {
        this.plugin.settings.ragMaxContextLength = value;
        await this.plugin.saveSettings();
      }
    );
  }

  /**
   * Render chat settings section
   */
  private renderChatSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Chat Settings' });

    new Setting(containerEl)
      .setName('System Prompt')
      .setDesc('Initial instructions for the AI assistant')
      .addTextArea(text => text
        .setValue(this.plugin.settings.systemPrompt)
        .onChange(async (value) => {
          this.plugin.settings.systemPrompt = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Include Chat History')
      .setDesc('Include previous messages in context')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeChatHistory)
        .onChange(async (value) => {
          this.plugin.settings.includeChatHistory = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Max History Messages')
      .setDesc('Maximum number of history messages to include')
      .addSlider(slider => slider
        .setLimits(1, 50, 1)
        .setValue(this.plugin.settings.maxHistoryMessages)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxHistoryMessages = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Creativity of responses (0=focused, 2=creative)')
      .addSlider(slider => slider
        .setLimits(0, 2, 0.1)
        .setValue(this.plugin.settings.chatTemperature)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.chatTemperature = value;
          await this.plugin.saveSettings();
        })
      );

    this.createNumericSetting(
      containerEl,
      'Max Tokens',
      'Maximum tokens in response (100+)',
      this.plugin.settings.chatMaxTokens,
      { min: 100, max: 100000, placeholder: '2048' },
      async (value) => {
        this.plugin.settings.chatMaxTokens = value;
        await this.plugin.saveSettings();
      }
    );
  }

  /**
   * Render tool calling settings section
   */
  private renderToolCallingSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Tool Calling (Agent Mode)' });
    
    containerEl.createEl('p', { 
      text: 'Enable Calcifer to perform actions in your vault like creating folders, moving notes, and more.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('Enable Tool Calling')
      .setDesc('Allow Calcifer to execute vault operations (create folders, move notes, etc.)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableToolCalling)
        .onChange(async (value) => {
          this.plugin.settings.enableToolCalling = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Require Confirmation')
      .setDesc('Ask for confirmation before destructive operations (delete notes/folders)')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.requireToolConfirmation)
        .onChange(async (value) => {
          this.plugin.settings.requireToolConfirmation = value;
          await this.plugin.saveSettings();
        })
      );
    
    // Show available tools
    const toolsInfo = containerEl.createDiv({ cls: 'calcifer-tools-info' });
    toolsInfo.createEl('h4', { text: 'Available Tools' });
    const toolsList = toolsInfo.createEl('ul');
    const tools = [
      'create_folder - Create new folders',
      'move_note - Move notes between folders',
      'rename_note - Rename notes',
      'create_note - Create new notes',
      'delete_note - Delete notes (to trash)',
      'append_to_note - Add content to end of note',
      'prepend_to_note - Add content to beginning of note',
      'add_tag / remove_tag - Manage note tags',
      'update_frontmatter - Update note properties',
      'search_notes - Search for notes',
      'list_folder_contents - List folder contents',
      'open_note - Open a note in editor',
    ];
    tools.forEach(tool => {
      toolsList.createEl('li', { text: tool });
    });
  }

  /**
   * Render memory settings section
   */
  private renderMemorySection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Memory Settings' });

    new Setting(containerEl)
      .setName('Enable Memory')
      .setDesc('Store persistent memories across conversations')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableMemory)
        .onChange(async (value) => {
          this.plugin.settings.enableMemory = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Max Memories')
      .setDesc('Maximum number of memories to store')
      .addSlider(slider => slider
        .setLimits(10, 500, 10)
        .setValue(this.plugin.settings.maxMemories)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxMemories = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Include in Context')
      .setDesc('Include memories in chat context')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.includeMemoriesInContext)
        .onChange(async (value) => {
          this.plugin.settings.includeMemoriesInContext = value;
          await this.plugin.saveSettings();
        })
      );

    // Memory management button
    new Setting(containerEl)
      .setName('Manage Memories')
      .setDesc(`${this.plugin.memoryManager?.getMemoryCount() ?? 0} memories stored`)
      .addButton(button => button
        .setButtonText('View & Manage')
        .onClick(() => {
          new MemoryModal(this.app, this.plugin.memoryManager).open();
        })
      );
  }

  /**
   * Render auto-tagging settings section
   */
  private renderAutoTagSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Auto-Tagging Settings' });

    new Setting(containerEl)
      .setName('Enable Auto-Tagging')
      .setDesc('Automatically suggest or apply tags to notes')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableAutoTag)
        .onChange(async (value) => {
          this.plugin.settings.enableAutoTag = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Auto-Tag Mode')
      .setDesc('How to apply suggested tags')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Auto-apply')
        .addOption('suggest', 'Suggest only')
        .setValue(this.plugin.settings.autoTagMode)
        .onChange(async (value: 'auto' | 'suggest') => {
          this.plugin.settings.autoTagMode = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Max Suggestions')
      .setDesc('Maximum tags to suggest per note')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.maxTagSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTagSuggestions = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Use Existing Tags')
      .setDesc('Prefer tags already used in the vault')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useExistingTags)
        .onChange(async (value) => {
          this.plugin.settings.useExistingTags = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Confidence Threshold')
      .setDesc('Minimum confidence for auto-apply (0-1)')
      .addSlider(slider => slider
        .setLimits(0.5, 1, 0.05)
        .setValue(this.plugin.settings.autoTagConfidence)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.autoTagConfidence = value;
          await this.plugin.saveSettings();
        })
      );
  }

  /**
   * Render organization settings section
   */
  private renderOrganizationSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Organization Settings' });

    new Setting(containerEl)
      .setName('Enable Auto-Organization')
      .setDesc('Suggest folder placement for notes')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableAutoOrganize)
        .onChange(async (value) => {
          this.plugin.settings.enableAutoOrganize = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Organization Mode')
      .setDesc('How to handle folder suggestions')
      .addDropdown(dropdown => dropdown
        .addOption('auto', 'Auto-move')
        .addOption('suggest', 'Suggest only')
        .setValue(this.plugin.settings.autoOrganizeMode)
        .onChange(async (value: 'auto' | 'suggest') => {
          this.plugin.settings.autoOrganizeMode = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Confidence Threshold')
      .setDesc('Minimum confidence for auto-move (0-1)')
      .addSlider(slider => slider
        .setLimits(0.5, 1, 0.05)
        .setValue(this.plugin.settings.autoOrganizeConfidence)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.autoOrganizeConfidence = value;
          await this.plugin.saveSettings();
        })
      );
  }

  /**
   * Render UI settings section
   */
  private renderUISection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'UI Settings' });

    new Setting(containerEl)
      .setName('Show Context Sources')
      .setDesc('Display source notes in chat responses')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showContextSources)
        .onChange(async (value) => {
          this.plugin.settings.showContextSources = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Show Indexing Progress')
      .setDesc('Display notifications during vault indexing')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showIndexingProgress)
        .onChange(async (value) => {
          this.plugin.settings.showIndexingProgress = value;
          await this.plugin.saveSettings();
        })
      );
  }

  /**
   * Render performance settings section
   */
  private renderPerformanceSection(containerEl: HTMLElement): void {
    containerEl.createEl('h2', { text: 'Performance Settings' });

    new Setting(containerEl)
      .setName('Enable on Mobile')
      .setDesc('Enable plugin features on mobile devices')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableOnMobile)
        .onChange(async (value) => {
          this.plugin.settings.enableOnMobile = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Rate Limit (RPM)')
      .setDesc('Maximum requests per minute')
      .addSlider(slider => slider
        .setLimits(10, 120, 5)
        .setValue(this.plugin.settings.rateLimitRpm)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.rateLimitRpm = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Request Timeout')
      .setDesc('Timeout in seconds for API requests')
      .addSlider(slider => slider
        .setLimits(10, 120, 5)
        .setValue(this.plugin.settings.requestTimeoutMs / 1000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.requestTimeoutMs = value * 1000;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Use Native Fetch')
      .setDesc('Use native fetch API instead of Obsidian requestUrl. Enable this if you have connection issues with internal/self-signed certificates.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useNativeFetch)
        .onChange(async (value) => {
          this.plugin.settings.useNativeFetch = value;
          await this.plugin.saveSettings();
          // Reinitialize providers with new setting
          this.plugin.providerManager?.updateSettings(this.plugin.settings);
        })
      );
  }

  /**
   * Validate settings and show warnings
   */
  private validateAndShowWarnings(containerEl: HTMLElement): void {
    const errors = validateSettings(this.plugin.settings);
    
    if (errors.length > 0) {
      const warningEl = containerEl.createDiv({ cls: 'calcifer-settings-warnings' });
      warningEl.createEl('h3', { text: '⚠️ Configuration Issues' });
      
      const list = warningEl.createEl('ul');
      for (const error of errors) {
        list.createEl('li', { text: error });
      }
    }
  }
}
