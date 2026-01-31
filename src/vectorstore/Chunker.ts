/**
 * Text Chunker
 * 
 * Splits text into overlapping chunks for embedding.
 * Handles markdown structure awareness.
 */

/**
 * Chunk metadata
 */
export interface Chunk {
  /** Chunk content */
  content: string;
  /** Start position in original text */
  startPos: number;
  /** End position in original text */
  endPos: number;
  /** Chunk index */
  index: number;
}

/**
 * Chunker options
 */
export interface ChunkerOptions {
  /** Maximum chunk size in characters */
  chunkSize: number;
  /** Overlap between chunks in characters */
  overlap: number;
  /** Respect markdown headers as chunk boundaries */
  respectHeaders: boolean;
  /** Minimum chunk size (chunks smaller than this are merged) */
  minChunkSize: number;
}

const DEFAULT_OPTIONS: ChunkerOptions = {
  chunkSize: 1000,
  overlap: 200,
  respectHeaders: true,
  minChunkSize: 100,
};

/**
 * Split text into overlapping chunks
 */
export function chunkText(
  text: string,
  options: Partial<ChunkerOptions> = {}
): Chunk[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { chunkSize, overlap, respectHeaders, minChunkSize } = opts;
  
  if (!text || text.trim().length === 0) {
    return [];
  }
  
  // Clean and normalize text
  const cleanedText = cleanText(text);
  
  if (cleanedText.length <= chunkSize) {
    return [{
      content: cleanedText,
      startPos: 0,
      endPos: cleanedText.length,
      index: 0,
    }];
  }
  
  const chunks: Chunk[] = [];
  
  if (respectHeaders) {
    // Split by headers first, then chunk each section
    const sections = splitByHeaders(cleanedText);
    let globalIndex = 0;
    
    for (const section of sections) {
      const sectionChunks = chunkSection(section.content, chunkSize, overlap, minChunkSize);
      
      for (const chunk of sectionChunks) {
        chunks.push({
          content: section.header ? `${section.header}\n\n${chunk.content}` : chunk.content,
          startPos: section.startPos + chunk.startPos,
          endPos: section.startPos + chunk.endPos,
          index: globalIndex++,
        });
      }
    }
  } else {
    // Simple chunking without header awareness
    const simpleChunks = chunkSection(cleanedText, chunkSize, overlap, minChunkSize);
    
    for (let i = 0; i < simpleChunks.length; i++) {
      chunks.push({
        ...simpleChunks[i],
        index: i,
      });
    }
  }
  
  return chunks;
}

/**
 * Split text by markdown headers
 */
interface Section {
  header: string;
  content: string;
  startPos: number;
}

function splitByHeaders(text: string): Section[] {
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections: Section[] = [];
  
  let lastEnd = 0;
  let lastHeader = '';
  let match;
  
  while ((match = headerRegex.exec(text)) !== null) {
    // Add previous section
    if (match.index > lastEnd) {
      const content = text.slice(lastEnd, match.index).trim();
      if (content.length > 0) {
        sections.push({
          header: lastHeader,
          content,
          startPos: lastEnd,
        });
      }
    }
    
    // Update for next section
    lastHeader = match[0];
    lastEnd = match.index + match[0].length;
  }
  
  // Add final section
  if (lastEnd < text.length) {
    const content = text.slice(lastEnd).trim();
    if (content.length > 0) {
      sections.push({
        header: lastHeader,
        content,
        startPos: lastEnd,
      });
    }
  }
  
  // Handle case with no headers
  if (sections.length === 0) {
    sections.push({
      header: '',
      content: text,
      startPos: 0,
    });
  }
  
  return sections;
}

/**
 * Chunk a section of text with overlap
 */
function chunkSection(
  text: string,
  chunkSize: number,
  overlap: number,
  minChunkSize: number
): Omit<Chunk, 'index'>[] {
  const chunks: Omit<Chunk, 'index'>[] = [];
  
  if (text.length <= chunkSize) {
    return [{
      content: text,
      startPos: 0,
      endPos: text.length,
    }];
  }
  
  let startPos = 0;
  let lastStartPos = -1; // Track to prevent infinite loops
  
  while (startPos < text.length) {
    // Prevent infinite loop - if startPos didn't advance, break
    if (startPos === lastStartPos) {
      console.warn('[Calcifer] Chunker: breaking infinite loop at startPos', startPos);
      break;
    }
    lastStartPos = startPos;
    
    let endPos = Math.min(startPos + chunkSize, text.length);
    
    // Try to find a good break point (sentence or paragraph boundary)
    if (endPos < text.length) {
      const breakPoint = findBreakPoint(text, startPos, endPos);
      if (breakPoint > startPos + minChunkSize) {
        endPos = breakPoint;
      }
    }
    
    const chunk = text.slice(startPos, endPos).trim();
    
    if (chunk.length >= minChunkSize || chunks.length === 0) {
      chunks.push({
        content: chunk,
        startPos,
        endPos,
      });
    } else if (chunks.length > 0) {
      // Merge small chunk with previous
      const prev = chunks[chunks.length - 1];
      prev.content = text.slice(prev.startPos, endPos).trim();
      prev.endPos = endPos;
    }
    
    // Move to next chunk with overlap
    const nextStartPos = endPos - overlap;
    
    // Ensure we always make forward progress
    // If overlap would send us backwards or not far enough forward, just continue from endPos
    if (nextStartPos <= startPos) {
      startPos = endPos;
    } else {
      startPos = nextStartPos;
    }
    
    // If we've reached the end, break
    if (endPos >= text.length) {
      break;
    }
  }
  
  return chunks;
}

/**
 * Find a good break point for chunking
 */
function findBreakPoint(text: string, start: number, maxEnd: number): number {
  const searchRange = text.slice(start, maxEnd);
  
  // Try to break at paragraph
  const paragraphBreak = searchRange.lastIndexOf('\n\n');
  if (paragraphBreak > 0) {
    return start + paragraphBreak + 2;
  }
  
  // Try to break at sentence
  const sentenceBreaks = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
  let lastSentenceBreak = -1;
  
  for (const breakStr of sentenceBreaks) {
    const pos = searchRange.lastIndexOf(breakStr);
    if (pos > lastSentenceBreak) {
      lastSentenceBreak = pos;
    }
  }
  
  if (lastSentenceBreak > 0) {
    return start + lastSentenceBreak + 2;
  }
  
  // Try to break at newline
  const newlineBreak = searchRange.lastIndexOf('\n');
  if (newlineBreak > 0) {
    return start + newlineBreak + 1;
  }
  
  // Try to break at space
  const spaceBreak = searchRange.lastIndexOf(' ');
  if (spaceBreak > 0) {
    return start + spaceBreak + 1;
  }
  
  // No good break point found
  return maxEnd;
}

/**
 * Clean text for embedding
 */
export function cleanText(text: string): string {
  return text
    // Remove YAML frontmatter
    .replace(/^---[\s\S]*?---\n?/, '')
    // Remove code blocks (keep description)
    .replace(/```[\s\S]*?```/g, '[code block]')
    // Remove inline code
    .replace(/`[^`]+`/g, (match) => match.slice(1, -1))
    // Remove image syntax but keep alt text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // Remove link syntax but keep link text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove HTML tags
    .replace(/<[^>]+>/g, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract frontmatter from markdown
 */
export function extractFrontmatter(text: string): Record<string, unknown> | null {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  
  try {
    // Simple YAML parsing for common cases
    const yaml = match[1];
    const result: Record<string, unknown> = {};
    
    const lines = yaml.split('\n');
    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        let value: unknown = line.slice(colonIndex + 1).trim();
        
        // Parse arrays
        if (value === '') {
          // Could be a multi-line value, skip for now
          continue;
        }
        
        // Parse booleans
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        // Parse numbers
        else if (!isNaN(Number(value))) value = Number(value);
        // Parse arrays (simple case)
        else if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
          value = value.slice(1, -1).split(',').map(s => s.trim());
        }
        
        result[key] = value;
      }
    }
    
    return result;
  } catch {
    return null;
  }
}
