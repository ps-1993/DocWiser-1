import { config } from '../config.js';
import {
  createTemplate,
  createValidationResult,
  getTemplate,
  listTemplates
} from '../db/oracle.js';
import { generateTemplateRules, generateTemplateValidation } from './aiClient.js';
import { extractTextFromFile } from './documentParser.js';
import { indexFileInVectorStore } from './ociVectorStore.js';

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

export async function ingestTemplate(file) {
  const extractedText = await extractTextFromFile(file.path);
  const templateText = extractedText.trim();

  if (!templateText) {
    throw new Error('No readable text was extracted from the uploaded template.');
  }

  const indexedTemplate = await indexFileInVectorStore(file);
  const rules = await generateTemplateRules(templateText);
  const templateId = await createTemplate({
    originalName: file.originalname,
    storedName: file.filename,
    storagePath: file.path,
    mimeType: file.mimetype,
    fileSize: file.size,
    templateText,
    rulesJson: JSON.stringify(rules),
    documentStoreProvider: config.documentStore.provider,
    ociFileId: indexedTemplate.ociFileId,
    ociVectorStoreFileId: indexedTemplate.ociVectorStoreFileId
  });

  return {
    templateId,
    originalName: file.originalname,
    documentStoreProvider: config.documentStore.provider,
    ociFileId: indexedTemplate.ociFileId,
    ociVectorStoreFileId: indexedTemplate.ociVectorStoreFileId,
    rules
  };
}

export async function validateDocumentAgainstTemplate(templateId, file) {
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

  const indexedDocument = await indexFileInVectorStore(file);
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
    documentStoreProvider: config.documentStore.provider,
    ociFileId: indexedDocument.ociFileId,
    ociVectorStoreFileId: indexedDocument.ociVectorStoreFileId
  });

  return {
    validationResultId,
    templateId: numericTemplateId,
    templateName: template.ORIGINAL_NAME,
    documentName: file.originalname,
    documentStoreProvider: config.documentStore.provider,
    ociFileId: indexedDocument.ociFileId,
    ociVectorStoreFileId: indexedDocument.ociVectorStoreFileId,
    result: validation
  };
}

export { listTemplates };
