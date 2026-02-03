/**
 * Tool Executor
 * 
 * Executes vault operations based on tool calls from the LLM.
 * Each tool function performs the actual Obsidian API operations.
 */

import { App, TFile, TFolder, TAbstractFile, normalizePath } from 'obsidian';
import { ToolCall, ToolResult, getToolByName } from './definitions';

/**
 * Frontmatter type for processFrontMatter callback
 */
interface Frontmatter {
  tags?: string | string[];
  [key: string]: unknown;
}

/**
 * Executes tools in the Obsidian vault
 */
export class ToolExecutor {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  /**
   * Find a file by path, trying multiple strategies
   * 1. Exact path match
   * 2. Path with .md extension added
   * 3. Case-insensitive basename match
   * 4. Partial path match
   */
  private findFile(pathInput: string): TFile | null {
    let path = pathInput.trim();
    
    // Remove leading slash if present
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    
    // Strategy 1: Exact path
    let file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) return file;
    
    // Strategy 2: Add .md extension
    if (!path.endsWith('.md')) {
      file = this.app.vault.getAbstractFileByPath(normalizePath(path + '.md'));
      if (file instanceof TFile) return file;
    }
    
    // Strategy 3: Case-insensitive search by basename
    const searchName = path.replace(/\.md$/i, '').toLowerCase();
    const allFiles = this.app.vault.getMarkdownFiles();
    
    // Exact basename match (case-insensitive)
    const exactMatch = allFiles.find(f => f.basename.toLowerCase() === searchName);
    if (exactMatch) return exactMatch;
    
    // Strategy 4: Path contains match (for when user specifies partial path)
    const pathMatch = allFiles.find(f => 
      f.path.toLowerCase().includes(searchName) ||
      f.path.toLowerCase() === path.toLowerCase() ||
      f.path.toLowerCase() === (path + '.md').toLowerCase()
    );
    if (pathMatch) return pathMatch;
    
    return null;
  }

  /**
   * Safely extract a string argument with validation
   */
  private getStringArg(args: Record<string, unknown>, key: string, defaultValue: string = ''): string {
    const value = args[key];

    if (value === undefined || value === null) {
      return defaultValue;
    }

    if (typeof value !== 'string') {
      throw new Error(`Argument "${key}" must be a string, got ${typeof value}`);
    }

    return value;
  }

  /**
   * Sanitize a path input for safe file operations
   * Prevents path traversal and removes dangerous characters
   */
  private sanitizePath(pathInput: string): string {
    let path = pathInput.trim();

    // Remove leading/trailing slashes
    path = path.replace(/^\/+|\/+$/g, '');

    // Remove potentially dangerous characters
    path = path.replace(/[<>:"|?*]/g, '');

    // Normalize multiple slashes
    path = path.replace(/\/+/g, '/');

    // Normalize the path
    const normalized = normalizePath(path);

    // Security: Prevent path traversal attacks
    // Check for .. segments or absolute paths that could escape the vault
    if (normalized.includes('..') || normalized.startsWith('/') || normalized.startsWith('\\')) {
      throw new Error(`Invalid path: "${pathInput}" attempts to access files outside the vault`);
    }

    return normalized;
  }

  /**
   * Execute a tool call and return the result
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const tool = getToolByName(toolCall.name);
    
    if (!tool) {
      return {
        success: false,
        message: `Unknown tool: ${toolCall.name}`,
      };
    }
    
    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required && !(param.name in toolCall.arguments)) {
        return {
          success: false,
          message: `Missing required parameter: ${param.name}`,
        };
      }
    }
    
    try {
      // Route to the appropriate handler
      switch (toolCall.name) {
        case 'create_folder':
          return await this.createFolder(toolCall.arguments);
        case 'delete_folder':
          return await this.deleteFolder(toolCall.arguments);
        case 'create_note':
          return await this.createNote(toolCall.arguments);
        case 'move_note':
          return await this.moveNote(toolCall.arguments);
        case 'rename_note':
          return await this.renameNote(toolCall.arguments);
        case 'delete_note':
          return await this.deleteNote(toolCall.arguments);
        case 'append_to_note':
          return await this.appendToNote(toolCall.arguments);
        case 'prepend_to_note':
          return await this.prependToNote(toolCall.arguments);
        case 'search_notes':
          return await this.searchNotes(toolCall.arguments);
        case 'list_folder_contents':
          return this.listFolderContents(toolCall.arguments);
        case 'get_note_content':
          return await this.getNoteContent(toolCall.arguments);
        case 'add_tag':
          return await this.addTag(toolCall.arguments);
        case 'remove_tag':
          return await this.removeTag(toolCall.arguments);
        case 'update_frontmatter':
          return await this.updateFrontmatter(toolCall.arguments);
        case 'open_note':
          return await this.openNote(toolCall.arguments);
        default:
          return {
            success: false,
            message: `Tool not implemented: ${toolCall.name}`,
          };
      }
    } catch (error) {
      console.error(`[Calcifer] Tool execution error (${toolCall.name}):`, error);
      return {
        success: false,
        message: `Error executing ${toolCall.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // === Folder Operations ===

  private async createFolder(args: Record<string, unknown>): Promise<ToolResult> {
    const path = this.sanitizePath(this.getStringArg(args, 'path'));
    
    // Check if folder already exists
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      if (existing instanceof TFolder) {
        return {
          success: true,
          message: `Folder "${path}" already exists.`,
        };
      } else {
        return {
          success: false,
          message: `A file with the name "${path}" already exists.`,
        };
      }
    }
    
    // Create the folder
    await this.app.vault.createFolder(path);
    
    return {
      success: true,
      message: `Created folder "${path}".`,
    };
  }

  private async deleteFolder(args: Record<string, unknown>): Promise<ToolResult> {
    const path = this.sanitizePath(this.getStringArg(args, 'path'));
    const force = args.force === true;
    
    const folder = this.app.vault.getAbstractFileByPath(path);
    
    if (!folder) {
      return {
        success: false,
        message: `Folder "${path}" not found.`,
      };
    }
    
    if (!(folder instanceof TFolder)) {
      return {
        success: false,
        message: `"${path}" is not a folder.`,
      };
    }
    
    // Check if folder has children
    if (folder.children.length > 0 && !force) {
      return {
        success: false,
        message: `Folder "${path}" is not empty. Use force=true to delete recursively.`,
      };
    }
    
    await this.app.fileManager.trashFile(folder);
    
    return {
      success: true,
      message: `Deleted folder "${path}"${force ? ' and all its contents' : ''}.`,
    };
  }

  // === Note Operations ===

  private async createNote(args: Record<string, unknown>): Promise<ToolResult> {
    let path = this.getStringArg(args, 'path');
    const content = this.getStringArg(args, 'content', '');
    const overwrite = args.overwrite === true;

    // Ensure .md extension
    if (!path.endsWith('.md')) {
      path = path + '.md';
    }

    path = this.sanitizePath(path);
    
    // Check if file exists
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !overwrite) {
      return {
        success: false,
        message: `Note "${path}" already exists. Use overwrite=true to replace.`,
      };
    }
    
    // Create parent folder if needed
    const parentPath = path.substring(0, path.lastIndexOf('/'));
    if (parentPath) {
      const parentFolder = this.app.vault.getAbstractFileByPath(parentPath);
      if (!parentFolder) {
        await this.app.vault.createFolder(parentPath);
      }
    }
    
    if (existing && overwrite) {
      if (!(existing instanceof TFile)) {
        return { success: false, message: `"${path}" is not a file.` };
      }
      // Use vault.process for atomic file modification
      await this.app.vault.process(existing, () => content);
      return {
        success: true,
        message: `Overwrote note "${path}".`,
      };
    }
    
    await this.app.vault.create(path, content);
    
    return {
      success: true,
      message: `Created note "${path}".`,
    };
  }

  private async moveNote(args: Record<string, unknown>): Promise<ToolResult> {
    const sourcePath = this.getStringArg(args, 'sourcePath');
    const destinationFolder = this.sanitizePath(this.getStringArg(args, 'destinationFolder', ''));
    const newName = args.newName ? this.getStringArg(args, 'newName') : undefined;
    
    // Use robust file finding
    const file = this.findFile(sourcePath);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${sourcePath}" not found.`,
      };
    }
    
    return await this.moveNoteFile(file, destinationFolder, newName);
  }

  private async moveNoteFile(file: TFile, destinationFolder: string, newName?: string): Promise<ToolResult> {
    // Create destination folder if it doesn't exist
    if (destinationFolder) {
      const destFolder = this.app.vault.getAbstractFileByPath(destinationFolder);
      if (!destFolder) {
        await this.app.vault.createFolder(destinationFolder);
      }
    }
    
    const fileName = newName ? `${newName}.md` : file.name;
    const newPath = destinationFolder ? normalizePath(`${destinationFolder}/${fileName}`) : fileName;
    
    // Check if destination exists
    const existingDest = this.app.vault.getAbstractFileByPath(newPath);
    if (existingDest && existingDest.path !== file.path) {
      return {
        success: false,
        message: `A note already exists at "${newPath}".`,
      };
    }
    
    await this.app.fileManager.renameFile(file, newPath);
    
    return {
      success: true,
      message: `Moved "${file.path}" to "${newPath}".`,
    };
  }

  private async renameNote(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    const newName = this.getStringArg(args, 'newName');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    const parentPath = file.parent?.path || '';
    const newPath = parentPath ? `${parentPath}/${newName}.md` : `${newName}.md`;
    
    await this.app.fileManager.renameFile(file, normalizePath(newPath));
    
    return {
      success: true,
      message: `Renamed "${file.basename}" to "${newName}".`,
    };
  }

  private async deleteNote(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    const filePath = file.path;
    await this.app.fileManager.trashFile(file);
    
    return {
      success: true,
      message: `Deleted note "${filePath}" (moved to trash).`,
    };
  }

  private async appendToNote(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    const content = this.getStringArg(args, 'content');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    await this.app.vault.append(file, '\n' + content);
    
    return {
      success: true,
      message: `Appended content to "${file.path}".`,
    };
  }

  private async prependToNote(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    const content = this.getStringArg(args, 'content');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    await this.app.vault.process(file, (data) => {
      // Check for frontmatter
      if (data.startsWith('---')) {
        const endIndex = data.indexOf('---', 3);
        if (endIndex !== -1) {
          const frontmatter = data.substring(0, endIndex + 3);
          const rest = data.substring(endIndex + 3);
          return frontmatter + '\n' + content + rest;
        }
      }
      return content + '\n' + data;
    });
    
    return {
      success: true,
      message: `Prepended content to "${file.path}".`,
    };
  }

  // === Search & Information ===

  private async searchNotes(args: Record<string, unknown>): Promise<ToolResult> {
    const query = this.getStringArg(args, 'query').toLowerCase();
    const searchContent = args.searchContent === true;
    
    const files = this.app.vault.getMarkdownFiles();
    const results: string[] = [];
    
    for (const file of files) {
      // Search by file name
      if (file.basename.toLowerCase().includes(query) || file.path.toLowerCase().includes(query)) {
        results.push(file.path);
        continue;
      }
      
      // Search content if requested
      if (searchContent) {
        try {
          const content = await this.app.vault.cachedRead(file);
          if (content.toLowerCase().includes(query)) {
            results.push(file.path);
          }
        } catch (error) {
          // Log read errors but continue searching other files
          console.warn(`[Calcifer] Could not read file "${file.path}" during search:`, error);
        }
      }
      
      // Limit results
      if (results.length >= 20) break;
    }
    
    return {
      success: true,
      message: results.length > 0 
        ? `Found ${results.length} matching notes:\n${results.map(r => `- ${r}`).join('\n')}`
        : `No notes found matching "${query}".`,
      data: results,
    };
  }

  private listFolderContents(args: Record<string, unknown>): ToolResult {
    const pathInput = this.getStringArg(args, 'path', '');
    const path = pathInput ? this.sanitizePath(pathInput) : '';
    const recursive = args.recursive === true;
    
    let folder: TAbstractFile | null;
    
    if (!path || path === '/') {
      folder = this.app.vault.getRoot();
    } else {
      folder = this.app.vault.getAbstractFileByPath(path);
    }
    
    if (!folder) {
      return {
        success: false,
        message: `Folder "${path}" not found.`,
      };
    }
    
    if (!(folder instanceof TFolder)) {
      return {
        success: false,
        message: `"${path}" is not a folder.`,
      };
    }
    
    const contents = this.listFolder(folder, recursive);
    
    return {
      success: true,
      message: `Contents of "${path || 'vault root'}":\n${contents.map(c => `- ${c}`).join('\n')}`,
      data: contents,
    };
  }

  private listFolder(folder: TFolder, recursive: boolean, prefix: string = ''): string[] {
    const results: string[] = [];
    
    for (const child of folder.children) {
      const displayPath = prefix + child.name;
      
      if (child instanceof TFolder) {
        results.push(displayPath + '/');
        if (recursive) {
          results.push(...this.listFolder(child, true, displayPath + '/'));
        }
      } else {
        results.push(displayPath);
      }
    }
    
    return results;
  }

  private async getNoteContent(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    const content = await this.app.vault.cachedRead(file);
    
    return {
      success: true,
      message: `Content of "${file.path}":\n\n${content}`,
      data: content,
    };
  }

  // === Tag Operations ===
  // Note: Frontmatter operations use processFrontMatter which does read-modify-write.
  // Multiple simultaneous frontmatter operations on the same file may conflict.
  // The LLM should avoid calling multiple frontmatter tools on the same file in one response.

  private async addTag(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    let tag = this.getStringArg(args, 'tag');
    
    // Remove # prefix if present
    if (tag.startsWith('#')) {
      tag = tag.substring(1);
    }
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
      if (!frontmatter.tags) {
        frontmatter.tags = [];
      }
      if (!Array.isArray(frontmatter.tags)) {
        frontmatter.tags = [frontmatter.tags];
      }
      if (!frontmatter.tags.includes(tag)) {
        frontmatter.tags.push(tag);
      }
    });
    
    return {
      success: true,
      message: `Added tag "${tag}" to "${file.path}".`,
    };
  }

  private async removeTag(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    let tag = this.getStringArg(args, 'tag');
    
    // Remove # prefix if present
    if (tag.startsWith('#')) {
      tag = tag.substring(1);
    }
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    let removed = false;
    
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
      if (frontmatter.tags) {
        if (Array.isArray(frontmatter.tags)) {
          const index = frontmatter.tags.indexOf(tag);
          if (index !== -1) {
            frontmatter.tags.splice(index, 1);
            removed = true;
          }
        } else if (frontmatter.tags === tag) {
          delete frontmatter.tags;
          removed = true;
        }
      }
    });
    
    return {
      success: true,
      message: removed 
        ? `Removed tag "${tag}" from "${file.path}".`
        : `Tag "${tag}" was not found in "${file.path}".`,
    };
  }

  // === Frontmatter Operations ===

  private async updateFrontmatter(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    const property = this.getStringArg(args, 'property');
    const valueStr = this.getStringArg(args, 'value');
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    // Try to parse value as JSON
    let value: unknown;
    try {
      value = JSON.parse(valueStr);
    } catch {
      value = valueStr;
    }
    
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Frontmatter) => {
      frontmatter[property] = value;
    });
    
    return {
      success: true,
      message: `Updated property "${property}" in "${file.path}".`,
    };
  }

  // === Navigation ===

  private async openNote(args: Record<string, unknown>): Promise<ToolResult> {
    const pathInput = this.getStringArg(args, 'path');
    const newTab = args.newTab === true;
    
    const file = this.findFile(pathInput);
    
    if (!file) {
      return {
        success: false,
        message: `Note "${pathInput}" not found.`,
      };
    }
    
    const leaf = newTab 
      ? this.app.workspace.getLeaf('tab')
      : this.app.workspace.getLeaf();
    
    await leaf.openFile(file);
    
    return {
      success: true,
      message: `Opened "${file.path}".`,
    };
  }
}
