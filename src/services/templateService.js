import { config, DOCUMENT_STORE_PROVIDERS, normalizeDocumentStoreProvider } from '../config.js';
import {
  createTemplate,
  createValidationResult,
  getTemplate,
  listTemplates,
  replaceTemplateChunks,
  replaceValidationResultChunks
} from '../db/oracle.js';
import { embedTexts, generateTemplateRules, generateTemplateValidation } from './aiClient.js';
import { chunkText } from './chunking.js';
import { extractTextFromFile } from './documentParser.js';
import { indexFileInVectorStore } from './ociVectorStore.js';

function getProvider(value) {
  const provider = normalizeDocumentStoreProvider(value || config.documentStore.provider);

  if (!Object.values(DOCUMENT_STORE_PROVIDERS).includes(provider)) {
    throw new Error('Document store provider must be "oracle-db" or "oci-vector-store".');
  }

  return provider;
}

async function buildOracleChunks(text) {
  const chunks = chunkText(text, {
    chunkSize: config.rag.chunkSize,
    chunkOverlap: config.rag.chunkOverlap
  });

  if (chunks.length === 0) {
    throw new Error('No chunks were generated from the uploaded file.');
  }

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
  return { chunks, embeddings };
}

function parseRulesJson(value) {
  if (typeof value === 'object' && value !== null) {
    return value;
  }

  try {
    return JSON.parse(String(value || '{}'));
  } catch (_error) {
    throw new Error('Stored template rules are not valid JSON.');
  }
}

function normalizeForComparison(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildExactMatchValidation() {
  return {
    status: 'pass',
    score: 100,
    summary:
      'The submitted document contains the same text as the template, so no required details are missing.',
    passedChecks: [
      {
        requirement: 'All template details are present',
        evidence: 'The normalized template text and submitted document text match.'
      }
    ],
    failedChecks: [],
    warnings: [],
    missingFields: [],
    sectionIssues: [],
    formatIssues: [],
    recommendations: []
  };
}

export async function ingestTemplate(file, providerValue = config.documentStore.provider) {
  const provider = getProvider(providerValue);
  const extractedText = await extractTextFromFile(file.path);
  const templateText = extractedText.trim();

  if (!templateText) {
    throw new Error('No readable text was extracted from the uploaded template.');
  }

  const indexedTemplate = provider === DOCUMENT_STORE_PROVIDERS.OCI_VECTOR_STORE
    ? await indexFileInVectorStore(file)
    : null;
  const oracleTemplateIndex = provider === DOCUMENT_STORE_PROVIDERS.ORACLE_DB
    ? await buildOracleChunks(templateText)
    : null;
  const rules = await generateTemplateRules(templateText);
  const templateId = await createTemplate({
    originalName: file.originalname,
    storedName: file.filename,
    storagePath: file.path,
    mimeType: file.mimetype,
    fileSize: file.size,
    templateText,
    rulesJson: JSON.stringify(rules),
    documentStoreProvider: provider,
    ociFileId: indexedTemplate?.ociFileId || null,
    ociVectorStoreFileId: indexedTemplate?.ociVectorStoreFileId || null
  });

  if (oracleTemplateIndex) {
    await replaceTemplateChunks(templateId, oracleTemplateIndex.chunks, oracleTemplateIndex.embeddings);
  }

  return {
    templateId,
    originalName: file.originalname,
    documentStoreProvider: provider,
    ociFileId: indexedTemplate?.ociFileId || null,
    ociVectorStoreFileId: indexedTemplate?.ociVectorStoreFileId || null,
    rules
  };
}

export async function validateDocumentAgainstTemplate(templateId, file, providerValue = config.documentStore.provider) {
  const provider = getProvider(providerValue);
  const numericTemplateId = Number(templateId);

  if (!Number.isInteger(numericTemplateId) || numericTemplateId <= 0) {
    throw new Error('A valid templateId is required.');
  }

  const template = await getTemplate(numericTemplateId);

  if (!template) {
    throw new Error('Template not found.');
  }

  const extractedText = await extractTextFromFile(file.path);
  const documentText = extractedText.trim();

  if (!documentText) {
    throw new Error('No readable text was extracted from the uploaded document.');
  }

  const indexedDocument = provider === DOCUMENT_STORE_PROVIDERS.OCI_VECTOR_STORE
    ? await indexFileInVectorStore(file)
    : null;
  const oracleDocumentIndex = provider === DOCUMENT_STORE_PROVIDERS.ORACLE_DB
    ? await buildOracleChunks(documentText)
    : null;
  const rules = parseRulesJson(template.RULES_JSON);
  const templateText = String(template.TEMPLATE_TEXT || '').trim();
  const validation =
    normalizeForComparison(templateText) === normalizeForComparison(documentText)
      ? buildExactMatchValidation()
      : await generateTemplateValidation({
          rules,
          templateText,
          documentText
        });
  const validationResultId = await createValidationResult({
    templateId: numericTemplateId,
    documentName: file.originalname,
    resultJson: JSON.stringify(validation),
    documentStoreProvider: provider,
    ociFileId: indexedDocument?.ociFileId || null,
    ociVectorStoreFileId: indexedDocument?.ociVectorStoreFileId || null
  });

  if (oracleDocumentIndex) {
    await replaceValidationResultChunks(
      validationResultId,
      oracleDocumentIndex.chunks,
      oracleDocumentIndex.embeddings
    );
  }

  return {
    validationResultId,
    templateId: numericTemplateId,
    templateName: template.ORIGINAL_NAME,
    documentName: file.originalname,
    documentStoreProvider: provider,
    ociFileId: indexedDocument?.ociFileId || null,
    ociVectorStoreFileId: indexedDocument?.ociVectorStoreFileId || null,
    result: validation
  };
}

export { listTemplates };
