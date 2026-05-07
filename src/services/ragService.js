import fs from 'node:fs/promises';
import { config } from '../config.js';
import {
  createDocument,
  findDocumentById,
  findDocumentByOriginalName,
  listDocumentChunksById,
  listDocuments,
  updateDocumentForReupload,
  updateDocumentOciMetadata,
  updateDocumentStatus
} from '../db/oracle.js';
import {
  generateRagAnswer,
  generateDocumentSummary,
  generateSuggestedQuestions
} from './aiClient.js';
import { extractTextFromFile } from './documentParser.js';
import { indexFileInVectorStore, searchVectorStore } from './ociVectorStore.js';

export async function ingestDocument(file) {
  const existing = await findDocumentByOriginalName(file.originalname);
  let documentId = null;
  let previousStoredPath = null;

  if (existing) {
    documentId = existing.ID;
    previousStoredPath = existing.STORAGE_PATH || null;

    await updateDocumentForReupload(documentId, {
      storedName: file.filename,
      storagePath: file.path,
      mimeType: file.mimetype,
      fileSize: file.size,
      documentStoreProvider: config.documentStore.provider
    });
  } else {
    documentId = await createDocument({
      originalName: file.originalname,
      storedName: file.filename,
      storagePath: file.path,
      mimeType: file.mimetype,
      fileSize: file.size,
      documentStoreProvider: config.documentStore.provider
    });
  }

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

    if (previousStoredPath) {
      await fs.unlink(previousStoredPath).catch(() => null);
    }

    let suggestedQuestions = [];
    let suggestionError = null;
    let summary = '';
    let shortDescription = '';
    let summaryError = null;

    try {
      suggestedQuestions = await generateSuggestedQuestions(cleanedText);
    } catch (error) {
      suggestionError = error.message || 'Failed to generate suggested questions.';
    }

    try {
      summary = await generateDocumentSummary(cleanedText);
      shortDescription = buildShortDescription(summary, cleanedText);
    } catch (error) {
      summaryError = error.message || 'Failed to generate summary.';
    }

    await updateDocumentStatus(documentId, 'ready', {
      summaryText: summary || null,
      shortDescription: shortDescription || null
    });

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
      suggestionError,
      summary,
      summaryError,
      updatedExisting: Boolean(existing)
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

export async function suggestQuestionsForDocument(documentId, limit = 3) {
  if (!documentId) {
    return { questions: [] };
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 3, 6));
  const chunks = await listDocumentChunksById(documentId, Math.max(4, safeLimit * 2));

  let combinedText = chunks.map((chunk) => chunk.text).join('\n\n');

  if (!combinedText.trim()) {
    const document = await findDocumentById(documentId);
    if (document?.STORAGE_PATH) {
      const extractedText = await extractTextFromFile(document.STORAGE_PATH);
      combinedText = extractedText.trim();
    }
  }

  if (!combinedText) {
    return { questions: [] };
  }

  const raw = await generateSuggestedQuestions(combinedText);
  let questions = [];

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      questions = parsed.map((q) => String(q).trim()).filter(Boolean).slice(0, safeLimit);
    }
  } catch (_error) {
    const normalized = String(raw || '');
    questions = normalized
      .split('\n')
      .map((item) => item.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, safeLimit);
  }

  return { questions };
}

export async function summarizeDocument(documentId) {
  if (!documentId) {
    return { summary: '' };
  }

  const document = await findDocumentById(documentId);
  if (!document?.STORAGE_PATH) {
    return { summary: '' };
  }

  if (document.SUMMARY_TEXT) {
    return { summary: document.SUMMARY_TEXT };
  }

  const extractedText = await extractTextFromFile(document.STORAGE_PATH);
  const cleanedText = extractedText.trim();

  if (!cleanedText) {
    return { summary: '' };
  }

  const summary = await generateDocumentSummary(cleanedText);
  const shortDescription = buildShortDescription(summary, cleanedText);
  await updateDocumentStatus(documentId, document.STATUS || 'ready', {
    summaryText: summary || null,
    shortDescription: shortDescription || null
  });
  return { summary };
}

function buildShortDescription(summary, documentText) {
  const base = String(summary || '').trim();
  const fallback = String(documentText || '').trim();
  const raw = base || fallback;

  if (!raw) {
    return '';
  }

  const firstSentence = raw.split(/(?<=[.!?])\s+/)[0] || raw;
  const compact = firstSentence.replace(/\s+/g, ' ').trim();
  const maxLength = 120;

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 1).trim()}…`;
}

export { listDocuments };
