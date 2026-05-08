import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const OPENAI_DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const OLLAMA_DEFAULT_EMBEDDING_MODEL = 'llama3.1';
const OPENAI_DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
const OLLAMA_DEFAULT_CHAT_MODEL = 'llama3.1';
const OPENAI_DEFAULT_EMBEDDING_DIMENSION = 1536;
const OLLAMA_DEFAULT_EMBEDDING_DIMENSION = 4096;
const rawAiProvider = String(process.env.AI_PROVIDER || 'ollama').trim().toLowerCase();
export const DOCUMENT_STORE_PROVIDERS = {
  ORACLE_DB: 'oracle-db',
  OCI_VECTOR_STORE: 'oci-vector-store'
};

function normalizeAiProvider(value) {
  const provider = String(value || 'ollama').trim().toLowerCase();

  if (['openai-compatible', 'oci', 'oci-generative-ai'].includes(provider)) {
    return 'openai';
  }

  return provider;
}

function resolveOpenAiCompatibleBaseUrl(providerValue) {
  const rawProvider = String(providerValue || '').trim().toLowerCase();

  if (['oci', 'oci-generative-ai'].includes(rawProvider)) {
    return (
      process.env.OCI_GENERATIVE_AI_BASE_URL ||
      process.env.OCI_OPENAI_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.AI_BASE_URL ||
      OPENAI_DEFAULT_BASE_URL
    ).replace(/\/$/, '');
  }

  return (
    process.env.OPENAI_BASE_URL ||
    process.env.OCI_GENERATIVE_AI_BASE_URL ||
    process.env.OCI_OPENAI_BASE_URL ||
    process.env.AI_BASE_URL ||
    OPENAI_DEFAULT_BASE_URL
  ).replace(/\/$/, '');
}

function resolveOpenAiCompatibleApiKey() {
  return process.env.OPENAI_API_KEY || process.env.OCI_GENERATIVE_AI_API_KEY || '';
}

export function normalizeDocumentStoreProvider(value) {
  const provider = String(value || DOCUMENT_STORE_PROVIDERS.OCI_VECTOR_STORE).trim().toLowerCase();

  if (['oracle', 'local-oracle', 'local-oracle-db', 'oracle-db'].includes(provider)) {
    return DOCUMENT_STORE_PROVIDERS.ORACLE_DB;
  }

  if (['oci', 'oci-vector', 'oci-vector-store'].includes(provider)) {
    return DOCUMENT_STORE_PROVIDERS.OCI_VECTOR_STORE;
  }

  return provider;
}

function resolveAiModel(value, { provider, openaiDefault, ollamaDefault }) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return provider === 'ollama' ? ollamaDefault : openaiDefault;
  }

  if (provider === 'ollama' && normalized === openaiDefault) {
    return ollamaDefault;
  }

  return normalized;
}

function resolveEmbeddingDimension(value, { provider, embeddingModel }) {
  const normalized = String(value || '').trim();

  if (!normalized) {
    return provider === 'ollama'
      ? OLLAMA_DEFAULT_EMBEDDING_DIMENSION
      : OPENAI_DEFAULT_EMBEDDING_DIMENSION;
  }

  const parsedValue = Number(normalized);

  if (
    provider === 'ollama' &&
    parsedValue === OPENAI_DEFAULT_EMBEDDING_DIMENSION &&
    embeddingModel === OLLAMA_DEFAULT_EMBEDDING_MODEL
  ) {
    return OLLAMA_DEFAULT_EMBEDDING_DIMENSION;
  }

  return parsedValue;
}

const aiProvider = normalizeAiProvider(rawAiProvider);
const resolvedEmbeddingModel = resolveAiModel(process.env.EMBEDDING_MODEL, {
  provider: aiProvider,
  openaiDefault: OPENAI_DEFAULT_EMBEDDING_MODEL,
  ollamaDefault: OLLAMA_DEFAULT_EMBEDDING_MODEL
});
const resolvedChatModel = resolveAiModel(process.env.CHAT_MODEL, {
  provider: aiProvider,
  openaiDefault: OPENAI_DEFAULT_CHAT_MODEL,
  ollamaDefault: OLLAMA_DEFAULT_CHAT_MODEL
});
const resolvedEmbeddingDimension = resolveEmbeddingDimension(process.env.EMBEDDING_DIMENSION, {
  provider: aiProvider,
  embeddingModel: resolvedEmbeddingModel
});

function resolveProjectPath(value) {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.resolve(projectRoot, value);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024),
  uploadDir: resolveProjectPath(process.env.UPLOAD_DIR || 'uploads'),
  documentStore: {
    provider: normalizeDocumentStoreProvider(process.env.DOCUMENT_STORE_PROVIDER)
  },
  oracle: {
    user: process.env.ORACLE_USER || '',
    password: process.env.ORACLE_PASSWORD || '',
    connectString: process.env.ORACLE_CONNECT_STRING || '',
    poolMin: Number(process.env.ORACLE_POOL_MIN || 1),
    poolMax: Number(process.env.ORACLE_POOL_MAX || 5),
    poolIncrement: Number(process.env.ORACLE_POOL_INCREMENT || 1)
  },
  ai: {
    provider: aiProvider,
    rawProvider: rawAiProvider,
    baseUrl: (
      aiProvider === 'ollama'
        ? process.env.OLLAMA_BASE_URL || process.env.AI_BASE_URL || OLLAMA_DEFAULT_BASE_URL
        : resolveOpenAiCompatibleBaseUrl(rawAiProvider)
    ).replace(/\/$/, ''),
    apiKey: aiProvider === 'openai' ? resolveOpenAiCompatibleApiKey() : '',
    projectId: aiProvider === 'openai'
      ? String(process.env.OCI_GENERATIVE_AI_PROJECT_ID || '').trim()
      : '',
    embeddingModel: resolvedEmbeddingModel,
    chatModel: resolvedChatModel,
    temperature: Number(process.env.CHAT_TEMPERATURE || 0.2),
    topP: Number(process.env.CHAT_TOP_P || 0.9)
  },
  rag: {
    chunkSize: Number(process.env.CHUNK_SIZE || 1200),
    chunkOverlap: Number(process.env.CHUNK_OVERLAP || 200),
    topK: Number(process.env.TOP_K || 4),
    embeddingDimension: resolvedEmbeddingDimension,
    maxContextChars: Number(process.env.MAX_CONTEXT_CHARS || 12000)
  },
  ociVectorStore: {
    region: String(process.env.OCI_REGION || '').trim(),
    generativeAiBaseUrl: String(
      process.env.OCI_GENERATIVE_AI_BASE_URL || process.env.OCI_OPENAI_BASE_URL || ''
    ).trim().replace(/\/$/, ''),
    apiKey: process.env.OCI_GENERATIVE_AI_API_KEY || '',
    projectId: String(process.env.OCI_GENERATIVE_AI_PROJECT_ID || '').trim(),
    vectorStoreId: String(process.env.OCI_VECTOR_STORE_ID || '').trim(),
    filePurpose: process.env.OCI_FILE_PURPOSE || 'assistants',
    pollIntervalMs: Number(process.env.OCI_VECTOR_STORE_POLL_INTERVAL_MS || 2000),
    pollTimeoutMs: Number(process.env.OCI_VECTOR_STORE_POLL_TIMEOUT_MS || 120000)
  },
  ociGenerativeAi: {
    inferenceBaseUrl: String(
      process.env.OCI_GENERATIVE_AI_INFERENCE_BASE_URL ||
      (process.env.OCI_REGION
        ? `https://inference.generativeai.${process.env.OCI_REGION}.oci.oraclecloud.com`
        : '')
    ).trim().replace(/\/$/, ''),
    compartmentId: String(process.env.OCI_COMPARTMENT_ID || '').trim(),
    documentEmbeddingInputType: String(
      process.env.OCI_DOCUMENT_EMBEDDING_INPUT_TYPE || 'SEARCH_DOCUMENT'
    ).trim(),
    queryEmbeddingInputType: String(
      process.env.OCI_QUERY_EMBEDDING_INPUT_TYPE || 'SEARCH_QUERY'
    ).trim()
  }
};

export function validateConfig() {
  const missing = [];

  if (!['openai', 'ollama'].includes(config.ai.provider)) {
    throw new Error('AI_PROVIDER must be "openai", "ollama", or "oci".');
  }

  if (!Object.values(DOCUMENT_STORE_PROVIDERS).includes(config.documentStore.provider)) {
    throw new Error('DOCUMENT_STORE_PROVIDER must be "oracle-db" or "oci-vector-store".');
  }

  if (!config.oracle.user) missing.push('ORACLE_USER');
  if (!config.oracle.password) missing.push('ORACLE_PASSWORD');
  if (!config.oracle.connectString) missing.push('ORACLE_CONNECT_STRING');
  if (!config.ai.embeddingModel) missing.push('EMBEDDING_MODEL');
  if (!config.ai.chatModel) missing.push('CHAT_MODEL');
  if (config.ai.rawProvider === 'oci') {
    if (!config.ociGenerativeAi.inferenceBaseUrl) {
      missing.push('OCI_GENERATIVE_AI_INFERENCE_BASE_URL or OCI_REGION');
    }

    if (!config.ociGenerativeAi.compartmentId) {
      missing.push('OCI_COMPARTMENT_ID');
    }
  }

  const requiresApiKey = config.ai.provider === 'openai' && /api\.openai\.com/i.test(config.ai.baseUrl);
  if (requiresApiKey && !config.ai.apiKey) {
    missing.push('OPENAI_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  if (!Number.isInteger(config.rag.embeddingDimension) || config.rag.embeddingDimension <= 0) {
    throw new Error('EMBEDDING_DIMENSION must be a positive integer.');
  }

  if (config.rag.chunkOverlap >= config.rag.chunkSize) {
    throw new Error('CHUNK_OVERLAP must be smaller than CHUNK_SIZE.');
  }
}
