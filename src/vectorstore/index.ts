/**
 * Vector Store Module
 * 
 * Exports vector storage and chunking utilities.
 */

export { VectorStore, cosineSimilarity, euclideanDistance } from './VectorStore';
export type { VectorDocument, SearchResult, VectorStoreStats } from './VectorStore';
export { chunkText, cleanText, extractFrontmatter } from './Chunker';
export type { Chunk, ChunkerOptions } from './Chunker';
