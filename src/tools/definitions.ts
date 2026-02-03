/**
 * Tool Definitions
 * 
 * Defines all available tools that Calcifer can use to perform vault operations.
 * Each tool has a name, description, and parameter schema.
 */

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  required: boolean;
  enum?: string[];
}

/**
 * Tool definition
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  examples?: string[];
}

/**
 * Tool call parsed from LLM response
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * All available tools for vault operations
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // === Folder Operations ===
  {
    name: 'create_folder',
    description: 'Create a new folder in the vault. Can create nested folders.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'The path of the folder to create (e.g., "Projects/2024" or "Inbox")',
        required: true,
      },
    ],
    examples: [
      'Create an Inbox folder',
      'Make a new folder called Projects/Work',
    ],
  },
  {
    name: 'delete_folder',
    description: 'Delete an empty folder from the vault. Will fail if folder contains files.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'The path of the folder to delete',
        required: true,
      },
      {
        name: 'force',
        type: 'boolean',
        description: 'If true, delete folder and all contents recursively. Use with caution!',
        required: false,
      },
    ],
  },
  
  // === Note Operations ===
  {
    name: 'create_note',
    description: 'Create a new note/file in the vault with optional content.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'The path for the new note including filename (e.g., "Projects/my-note.md"). Will add .md extension if missing.',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Initial content for the note. Can include frontmatter, headers, etc.',
        required: false,
      },
      {
        name: 'overwrite',
        type: 'boolean',
        description: 'If true, overwrite existing file. Default is false (will fail if file exists).',
        required: false,
      },
    ],
    examples: [
      'Create a new note called "Meeting Notes" in the Meetings folder',
      'Make a new daily note with today\'s date',
    ],
  },
  {
    name: 'move_note',
    description: 'Move a note to a different folder. The filename stays the same unless newName is provided.',
    parameters: [
      {
        name: 'sourcePath',
        type: 'string',
        description: 'Current path of the note to move (e.g., "Inbox/my-note.md" or just "my-note" for root)',
        required: true,
      },
      {
        name: 'destinationFolder',
        type: 'string',
        description: 'Destination folder path (e.g., "Projects/Active"). Use empty string for root.',
        required: true,
      },
      {
        name: 'newName',
        type: 'string',
        description: 'Optional new name for the note (without .md extension)',
        required: false,
      },
    ],
    examples: [
      'Move the Welcome note to the Inbox folder',
      'Move all notes from Unsorted to Processed',
    ],
  },
  {
    name: 'rename_note',
    description: 'Rename a note. This will update all links to this note automatically.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Current path of the note',
        required: true,
      },
      {
        name: 'newName',
        type: 'string',
        description: 'New name for the note (without .md extension)',
        required: true,
      },
    ],
  },
  {
    name: 'delete_note',
    description: 'Delete a note from the vault. This action is permanent (moves to system trash).',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note to delete',
        required: true,
      },
    ],
  },
  {
    name: 'append_to_note',
    description: 'Append content to the end of an existing note.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note to append to',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to append',
        required: true,
      },
    ],
  },
  {
    name: 'prepend_to_note',
    description: 'Prepend content to the beginning of an existing note (after frontmatter if present).',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note to prepend to',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'Content to prepend',
        required: true,
      },
    ],
  },
  
  // === Search & Information ===
  {
    name: 'search_notes',
    description: 'Search for notes by name or content pattern.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query (file name pattern or text to find)',
        required: true,
      },
      {
        name: 'searchContent',
        type: 'boolean',
        description: 'If true, search within note content. If false, only search file names.',
        required: false,
      },
    ],
  },
  {
    name: 'list_folder_contents',
    description: 'List all files and subfolders in a folder.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Folder path to list. Use empty string or "/" for root.',
        required: false,
      },
      {
        name: 'recursive',
        type: 'boolean',
        description: 'If true, list contents recursively. Default is false.',
        required: false,
      },
    ],
  },
  {
    name: 'get_note_content',
    description: 'Read the full content of a note.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note to read',
        required: true,
      },
    ],
  },
  
  // === Tag Operations ===
  {
    name: 'add_tag',
    description: 'Add a tag to a note\'s frontmatter.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note',
        required: true,
      },
      {
        name: 'tag',
        type: 'string',
        description: 'Tag to add (without # prefix)',
        required: true,
      },
    ],
  },
  {
    name: 'remove_tag',
    description: 'Remove a tag from a note\'s frontmatter.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note',
        required: true,
      },
      {
        name: 'tag',
        type: 'string',
        description: 'Tag to remove (without # prefix)',
        required: true,
      },
    ],
  },
  
  // === Frontmatter Operations ===
  {
    name: 'update_frontmatter',
    description: 'Update or add a frontmatter property in a note.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note',
        required: true,
      },
      {
        name: 'property',
        type: 'string',
        description: 'Property name to set',
        required: true,
      },
      {
        name: 'value',
        type: 'string',
        description: 'Value to set (will be parsed as JSON if possible)',
        required: true,
      },
    ],
  },
  
  // === Open/Navigation ===
  {
    name: 'open_note',
    description: 'Open a note in the editor.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Path of the note to open',
        required: true,
      },
      {
        name: 'newTab',
        type: 'boolean',
        description: 'If true, open in a new tab. Default is false.',
        required: false,
      },
    ],
  },
];

/**
 * Get tool definition by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find(t => t.name === name);
}

/**
 * Generate a tool description string for the LLM system prompt
 */
export function generateToolDescriptions(): string {
  const lines: string[] = [
    '## ⚠️ CRITICAL: Tool Calling Instructions',
    '',
    '**YOU HAVE THE ABILITY TO EXECUTE ACTIONS IN THE VAULT.**',
    '',
    'When the user asks you to create, save, move, delete, or modify anything, you MUST use the tools provided.',
    '',
    '### ❌ WRONG - Do NOT do this:',
    'User: "Create a note about codecs"',
    'Assistant: "Here\'s information about codecs: [content]"  ← WRONG! You just displayed text, nothing was saved!',
    '',
    '### ✅ CORRECT - Do this instead:',
    'User: "Create a note about codecs"',
    'Assistant: I\'ll create a note about codecs.',
    '```tool',
    '{"tool": "create_note", "arguments": {"path": "Codecs", "content": "# Codecs\\n\\nCodecs are..."}}',
    '```',
    '',
    '### How to Call Tools',
    '',
    'Include a JSON code block with the language tag `tool`:',
    '',
    '```tool',
    '{"tool": "tool_name", "arguments": {"param1": "value1"}}',
    '```',
    '',
    '### CRITICAL RULES:',
    '1. **CREATE NOTE**: If user asks to "create a note", "save this", "make a note about X" → USE `create_note` tool',
    '2. **CREATE FOLDER**: If user asks to create a folder → USE `create_folder` tool',
    '3. **NEVER** just output content and assume it will be saved - it won\'t!',
    '4. The tool block EXECUTES the action - without it, NOTHING HAPPENS',
    '5. Put the full content inside the tool arguments, not outside the tool block',
    '6. **DO NOT** repeat or summarize the content after the tool block - results are shown automatically',
    '',
    '### Example - Creating a Note:',
    '```tool',
    '{"tool": "create_note", "arguments": {"path": "My New Note", "content": "# Title\\n\\nContent goes here..."}}',
    '```',
    '',
    '### Available Tools:',
    '',
  ];
  
  for (const tool of TOOL_DEFINITIONS) {
    lines.push(`**${tool.name}**: ${tool.description}`);
    
    if (tool.parameters.length > 0) {
      lines.push('Parameters:');
      for (const param of tool.parameters) {
        const required = param.required ? '(required)' : '(optional)';
        lines.push(`  - \`${param.name}\` ${required}: ${param.description}`);
      }
    }
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Check if a tool is destructive (can delete/overwrite data)
 */
export function isDestructiveTool(toolName: string): boolean {
  const destructiveTools = [
    'delete_note',
    'delete_folder',
  ];
  return destructiveTools.includes(toolName);
}

/**
 * Check if a tool modifies data (vs read-only)
 */
export function isModifyingTool(toolName: string): boolean {
  const readOnlyTools = [
    'search_notes',
    'list_folder_contents',
    'get_note_content',
    'open_note',
  ];
  return !readOnlyTools.includes(toolName);
}

/**
 * Type guard to check if parsed JSON is a valid tool call structure
 */
interface ParsedToolCall {
  tool: string;
  arguments?: Record<string, unknown>;
}

function isParsedToolCall(value: unknown): value is ParsedToolCall {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tool' in value &&
    typeof (value as Record<string, unknown>).tool === 'string'
  );
}

/**
 * Parse tool calls from LLM response
 * Handles multiple formats: code blocks, inline JSON, and nested arguments
 *
 * Note: Deduplication only applies within the same parsing method (code blocks vs inline).
 * This allows legitimate duplicate operations across different blocks.
 */
export function parseToolCalls(response: string): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const seenBlockCalls = new Set<string>(); // Dedupe within code blocks only

  // Method 1: Match ```tool ... ``` blocks (preferred format)
  const toolBlockRegex = /```tool\s*([\s\S]*?)```/g;
  let match;

  while ((match = toolBlockRegex.exec(response)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const parsed: unknown = JSON.parse(jsonStr);

      if (isParsedToolCall(parsed)) {
        // Only dedupe exact same call in adjacent blocks (likely LLM stutter)
        const callKey = JSON.stringify({ tool: parsed.tool, args: parsed.arguments ?? {} });
        if (!seenBlockCalls.has(callKey)) {
          seenBlockCalls.add(callKey);
          toolCalls.push({
            name: parsed.tool,
            arguments: parsed.arguments ?? {},
          });
        }
      }
    } catch (error) {
      console.warn('[Calcifer] Failed to parse tool call from code block:', error, match[1]);
    }
  }

  // Method 2: Match ```json ... ``` blocks (some models use this)
  const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
  while ((match = jsonBlockRegex.exec(response)) !== null) {
    try {
      const jsonStr = match[1].trim();
      const parsed: unknown = JSON.parse(jsonStr);

      if (isParsedToolCall(parsed)) {
        // Dedupe against already found tool calls
        const callKey = JSON.stringify({ tool: parsed.tool, args: parsed.arguments ?? {} });
        if (!seenBlockCalls.has(callKey)) {
          seenBlockCalls.add(callKey);
          toolCalls.push({
            name: parsed.tool,
            arguments: parsed.arguments ?? {},
          });
        }
      }
    } catch {
      // Silently ignore - not all json blocks are tool calls
    }
  }

  // Method 3: Try to find JSON objects with "tool" key using balanced brace matching
  // Only search text OUTSIDE of code blocks to avoid double-parsing
  const textWithoutCodeBlocks = response
    .replace(/```[\s\S]*?```/g, '') // Remove all code blocks
    .replace(/`[^`]+`/g, '');       // Remove inline code

  const inlineMatches = findJsonToolCalls(textWithoutCodeBlocks);
  for (const parsed of inlineMatches) {
    // Dedupe against already found tool calls
    const callKey = JSON.stringify({ tool: parsed.tool, args: parsed.arguments ?? {} });
    if (!seenBlockCalls.has(callKey)) {
      seenBlockCalls.add(callKey);
      toolCalls.push({
        name: parsed.tool,
        arguments: parsed.arguments ?? {},
      });
    }
  }

  return toolCalls;
}

/**
 * Find JSON tool calls using balanced brace matching
 * Handles nested objects properly
 */
function findJsonToolCalls(text: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const results: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  
  // Look for potential start of tool call objects
  const toolPattern = /"tool"\s*:\s*"/g;
  let searchMatch;
  
  while ((searchMatch = toolPattern.exec(text)) !== null) {
    // Find the opening brace before this
    let braceStart = searchMatch.index;
    while (braceStart > 0 && text[braceStart] !== '{') {
      braceStart--;
    }
    
    if (text[braceStart] !== '{') continue;
    
    // Now find the matching closing brace
    let depth = 0;
    let braceEnd = braceStart;
    let inString = false;
    let escapeNext = false;
    
    for (let i = braceStart; i < text.length; i++) {
      const char = text[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') depth++;
        if (char === '}') {
          depth--;
          if (depth === 0) {
            braceEnd = i;
            break;
          }
        }
      }
    }
    
    if (depth !== 0) continue;
    
    // Extract and parse the JSON
    const jsonStr = text.substring(braceStart, braceEnd + 1);
    try {
      const parsed: unknown = JSON.parse(jsonStr);
      if (isParsedToolCall(parsed)) {
        results.push({
          tool: parsed.tool,
          arguments: parsed.arguments ?? {},
        });
      }
    } catch {
      // Invalid JSON, skip
    }
  }
  
  return results;
}

/**
 * Remove tool call blocks from response for clean display.
 * IMPORTANT: Only keeps text BEFORE the first tool block.
 * Everything after tool blocks is discarded because:
 * 1. Tool results are shown separately via "Actions performed"
 * 2. LLMs often redundantly repeat content after tool blocks
 */
export function removeToolBlocks(response: string): string {
  // Find the first tool block (```tool or ```json with tool call)
  const toolBlockMatch = response.match(/```(?:tool|json)\s*\{[\s\S]*?"tool"\s*:/);
  const inlineToolMatch = response.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/);

  // Find the earliest tool call position
  let cutoffIndex = response.length;

  if (toolBlockMatch && toolBlockMatch.index !== undefined) {
    cutoffIndex = Math.min(cutoffIndex, toolBlockMatch.index);
  }

  if (inlineToolMatch && inlineToolMatch.index !== undefined) {
    cutoffIndex = Math.min(cutoffIndex, inlineToolMatch.index);
  }

  // Only keep content BEFORE the first tool call
  let cleaned = response.substring(0, cutoffIndex);

  // Clean up extra whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  return cleaned;
}
