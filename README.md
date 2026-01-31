# Calcifer - AI-Powered Assistant for Obsidian

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue.svg" alt="Version">
  <img src="https://img.shields.io/badge/platform-desktop%20%7C%20mobile-green.svg" alt="Platform">
  <img src="https://img.shields.io/badge/license-MIT-purple.svg" alt="License">
</p>

Calcifer is an intelligent AI assistant that integrates deeply with your Obsidian vault. Using RAG (Retrieval-Augmented Generation), it understands your notes and provides contextual answers, auto-tagging, organization suggestions, and persistent memory.

## ✨ Features

### 🤖 AI Chat with Vault Context
- Chat interface in the right sidebar
- Retrieves relevant notes as context for answers
- Shows sources for every response
- Supports Ollama and OpenAI-compatible APIs

### 🏷️ Auto-Tagging
- Suggests tags based on note content
- Uses existing vault tags as reference
- Configurable auto-apply or suggest-only mode

### 📁 Note Organization
- Suggests appropriate folders for notes
- Based on content similarity to existing notes
- LLM-enhanced folder recommendations

### 🧠 Memory System
- Remembers facts about you across conversations
- Stored locally in plugin data (not sent to cloud)
- Manageable through settings

### 🔍 Semantic Search
- Full vault indexing with embeddings
- Find notes by meaning, not just keywords
- Automatic re-indexing on file changes

## 📋 Requirements

- Obsidian v1.0.0 or higher
- An AI API endpoint (one of the following):
  - **Ollama** (local or remote)
  - **OpenAI** (or compatible API like Azure OpenAI, Anthropic, etc.)

## 🚀 Installation

### From Community Plugins (Coming Soon)
1. Open Settings → Community plugins
2. Search for "Calcifer"
3. Click Install, then Enable

### Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create folder: `<vault>/.obsidian/plugins/calcifer/`
3. Copy the downloaded files into the folder
4. Enable the plugin in Settings → Community plugins

## ⚙️ Configuration

### 1. Add an API Endpoint

1. Open Settings → Calcifer
2. Click "Add Ollama" or "Add OpenAI"
3. Configure the endpoint:

#### For Ollama:
```
Base URL: http://localhost:11434
Chat Model: llama3.2
Embedding Model: nomic-embed-text
```

#### For OpenAI:
```
Base URL: https://api.openai.com
API Key: sk-...
Chat Model: gpt-4o-mini
Embedding Model: text-embedding-3-small
```

4. Click "Test" to verify connection
5. Enable the endpoint

### 2. Index Your Vault

- Use command: **Calcifer: Re-index Vault**
- Or wait for automatic background indexing

### 3. Start Chatting

- Click the 🤖 icon in the left ribbon
- Or use command: **Calcifer: Open Chat**

## 🎮 Commands

| Command | Description |
|---------|-------------|
| Open Calcifer Chat | Open the chat sidebar |
| Re-index Vault | Rebuild the embedding index |
| Clear Embedding Index | Delete all embeddings |
| Index Current File | Index only the active file |
| Show Memories | Display stored memories count |
| Suggest Tags for Current Note | Get AI tag suggestions |
| Suggest Folder for Current Note | Get folder placement suggestions |

## 🔧 Settings Reference

### Embedding Settings
- **Enable Embedding**: Toggle automatic indexing
- **Batch Size**: Concurrent embedding requests (default: 10)
- **Chunk Size**: Characters per text chunk (default: 1000)
- **Chunk Overlap**: Overlap between chunks (default: 200)
- **Exclude Patterns**: Glob patterns to skip (e.g., `templates/**`)

### RAG Settings
- **Top K Results**: Context chunks to retrieve (default: 5)
- **Minimum Score**: Similarity threshold (default: 0.5)
- **Include Frontmatter**: Add metadata to context
- **Max Context Length**: Total context limit (default: 8000)

### Chat Settings
- **System Prompt**: Customize assistant behavior
- **Include Chat History**: Send previous messages (default: true)
- **Max History Messages**: History limit (default: 10)
- **Temperature**: Response creativity (0-2)
- **Max Tokens**: Response length limit (default: 2048)

### Memory Settings
- **Enable Memory**: Store persistent memories
- **Max Memories**: Storage limit (default: 100)
- **Include in Context**: Send memories with queries

### Auto-Tagging Settings
- **Enable Auto-Tag**: Activate tagging feature
- **Mode**: `auto` (apply) or `suggest` (notify)
- **Max Suggestions**: Tags per note (default: 5)
- **Use Existing Tags**: Prefer vault tags
- **Confidence Threshold**: Auto-apply threshold (default: 0.8)

### Organization Settings
- **Enable Auto-Organize**: Activate folder suggestions
- **Mode**: `auto` (move) or `suggest` (ask)
- **Confidence Threshold**: Auto-move threshold (default: 0.9)

### Performance Settings
- **Enable on Mobile**: Run on mobile devices (default: true)
- **Rate Limit (RPM)**: API requests per minute (default: 60)
- **Request Timeout**: Seconds before timeout (default: 30)

## 📱 Mobile Support

Calcifer is fully functional on mobile devices:
- Chat interface optimized for touch
- Background indexing respects mobile resources
- All features work offline with local Ollama

## 🔒 Privacy & Security

- **Local Processing**: All embeddings stored locally in IndexedDB
- **No Cloud Storage**: Plugin data never leaves your device
- **API Choice**: Use local Ollama for complete privacy
- **Memory Control**: View and delete any stored memories

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/your-username/calcifer.git
cd calcifer

# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Production build
npm run build

# Lint
npm run lint
```

### Project Structure

```
calcifer/
├── main.ts              # Plugin entry point
├── styles.css           # Plugin styles
├── manifest.json        # Plugin metadata
└── src/
    ├── settings.ts      # Settings definitions
    ├── providers/       # AI provider implementations
    │   ├── types.ts
    │   ├── OllamaProvider.ts
    │   ├── OpenAIProvider.ts
    │   └── ProviderManager.ts
    ├── vectorstore/     # Embedding storage
    │   ├── VectorStore.ts
    │   └── Chunker.ts
    ├── embedding/       # Indexing orchestration
    │   └── EmbeddingManager.ts
    ├── rag/             # RAG pipeline
    │   └── RAGPipeline.ts
    ├── views/           # UI components
    │   ├── ChatView.ts
    │   └── SettingsTab.ts
    ├── features/        # Feature implementations
    │   ├── memory.ts
    │   ├── autoTag.ts
    │   └── organize.ts
    └── utils/           # Utilities
        ├── debounce.ts
        ├── rateLimiter.ts
        └── logger.ts
```

## 🐛 Troubleshooting

### "No provider configured"
- Add at least one API endpoint in settings
- Ensure the endpoint is enabled
- Test the connection

### "Connection failed"
- Check if Ollama is running (`ollama serve`)
- Verify the base URL is correct
- Check firewall/network settings

### Indexing is slow
- Reduce batch size for limited resources
- Exclude large folders (templates, archives)
- Mobile devices may need smaller chunk sizes

### Chat responses are irrelevant
- Ensure vault is indexed (check status bar)
- Lower the minimum score threshold
- Increase Top K for more context

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- [Obsidian](https://obsidian.md) for the amazing note-taking platform
- [Ollama](https://ollama.ai) for local LLM hosting
- The Obsidian plugin community for inspiration

## 📚 Developer Documentation

For AI agents and developers, see:
- [AGENTS.md](./AGENTS.md) - AI agent instructions
- [CALCIFER_SPEC.md](./CALCIFER_SPEC.md) - Technical specification
- [docs/](./docs/) - Obsidian plugin development guides

---

<p align="center">
  Made with 🔥 by Calcifer
</p>
