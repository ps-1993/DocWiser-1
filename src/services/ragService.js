import { config } from '../config.js';
import {
  createDocument,
  listDocuments,
  updateDocumentOciMetadata,
  updateDocumentStatus
} from '../db/oracle.js';
import {
  generateRagAnswer,
  generateSuggestedQuestions
} from './aiClient.js';
import { extractTextFromFile } from './documentParser.js';
import { indexFileInVectorStore, searchVectorStore } from './ociVectorStore.js';

export async function ingestDocument(file) {
  const documentId = await createDocument({
    originalName: file.originalname,
    storedName: file.filename,
    storagePath: file.path,
    mimeType: file.mimetype,
    fileSize: file.size,
    documentStoreProvider: config.documentStore.provider
  });

  try {
    const extractedText = await extractTextFromFile(file.path);
    const cleanedText = extractedText.trim();

    if (!cleanedText) {
      throw new Error('No readable text was extracted from the uploaded file.');
    }

    const indexedFile = await indexFileInVectorStore(file);
    await updateDocumentOciMetadata(documentId, {
      ociFileId: indexedFile.ociFileId,
      ociVectorStoreFileId: indexedFile.ociVectorStoreFileId,
      documentStoreProvider: config.documentStore.provider
    });
    await updateDocumentStatus(documentId, 'ready', {
      chunkCount: 0,
      errorMessage: null
    });

    let suggestedQuestions = [];
    let suggestionError = null;

    try {
      suggestedQuestions = await generateSuggestedQuestions(cleanedText);
    } catch (error) {
      suggestionError = error.message || 'Failed to generate suggested questions.';
    }

    return {
      documentId,
      originalName: file.originalname,
      storedName: file.filename,
      chunkCount: 0,
      status: 'ready',
      documentStoreProvider: config.documentStore.provider,
      ociFileId: indexedFile.ociFileId,
      ociVectorStoreFileId: indexedFile.ociVectorStoreFileId,
      suggestedQuestions,
      suggestionError
    };
  } catch (error) {
    await updateDocumentStatus(documentId, 'error', {
      errorMessage: error.message.slice(0, 4000)
    });

    throw error;
  }
}

export async function answerQuestion(question, topK) {
  const matches = await searchVectorStore(question, topK || config.rag.topK);

  if (matches.length === 0) {
    return {
      answer: 'No OCI vector store results were found. Please upload and index a document first.',
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
