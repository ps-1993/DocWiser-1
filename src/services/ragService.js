import { config } from '../config.js';
import {
  createDocument,
  insertDocumentChunks,
  listDocuments,
  searchSimilarChunks,
  updateDocumentStatus
} from '../db/oracle.js';
import { embedQuery, embedTexts, generateRagAnswer } from './aiClient.js';
import { chunkText } from './chunking.js';
import { extractTextFromFile } from './documentParser.js';

export async function ingestDocument(file) {
  const documentId = await createDocument({
    originalName: file.originalname,
    storedName: file.filename,
    storagePath: file.path,
    mimeType: file.mimetype,
    fileSize: file.size
  });

  try {
    const extractedText = await extractTextFromFile(file.path);
    const cleanedText = extractedText.trim();

    if (!cleanedText) {
      throw new Error('No readable text was extracted from the uploaded file.');
    }

    const chunks = chunkText(cleanedText, {
      chunkSize: config.rag.chunkSize,
      chunkOverlap: config.rag.chunkOverlap
    });

    if (chunks.length === 0) {
      throw new Error('Document chunking produced no chunks.');
    }

    const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
    const chunkRows = chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index]
    }));

    await insertDocumentChunks(documentId, chunkRows);
    await updateDocumentStatus(documentId, 'ready', {
      chunkCount: chunkRows.length,
      errorMessage: null
    });

    return {
      documentId,
      originalName: file.originalname,
      storedName: file.filename,
      chunkCount: chunkRows.length,
      status: 'ready'
    };
  } catch (error) {
    await updateDocumentStatus(documentId, 'error', {
      errorMessage: error.message.slice(0, 4000)
    });

    throw error;
  }
}

export async function answerQuestion(question, topK) {
  const queryEmbedding = await embedQuery(question);
  const matches = await searchSimilarChunks(queryEmbedding, topK || config.rag.topK);

  if (matches.length === 0) {
    return {
      answer: 'No indexed document chunks were found. Please upload a document first.',
      citations: [],
      matches: []
    };
  }

  const answer = await generateRagAnswer(question, matches);

  return {
    answer,
    citations: matches.map((match) => ({
      documentId: match.documentId,
      fileName: match.originalName,
      chunkIndex: match.chunkIndex,
      score: match.score
    })),
    matches
  };
}

export { listDocuments };
