import fs from 'node:fs/promises';
import { config } from '../config.js';

function getBaseUrl() {
  if (config.ociVectorStore.generativeAiBaseUrl) {
    return config.ociVectorStore.generativeAiBaseUrl;
  }

  return `https://inference.generativeai.${config.ociVectorStore.region}.oci.oraclecloud.com/openai/v1`;
}

function assertOciVectorStoreConfig() {
  const missing = [];

  if (!config.ociVectorStore.region && !config.ociVectorStore.generativeAiBaseUrl) {
    missing.push('OCI_REGION or OCI_GENERATIVE_AI_BASE_URL');
  }

  if (!config.ociVectorStore.apiKey) {
    missing.push('OCI_GENERATIVE_AI_API_KEY');
  }

  if (!config.ociVectorStore.projectId) {
    missing.push('OCI_GENERATIVE_AI_PROJECT_ID');
  }

  if (!config.ociVectorStore.vectorStoreId) {
    missing.push('OCI_VECTOR_STORE_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing OCI vector store configuration: ${missing.join(', ')}`);
  }
}

function buildHeaders(headers = {}) {
  return {
    ...headers,
    Authorization: `Bearer ${config.ociVectorStore.apiKey}`,
    'OpenAi-Project': config.ociVectorStore.projectId
  };
}

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function buildApiError(method, path, status, payload) {
  const details = payload?.error?.message || payload?.message || payload?.raw || 'No response details.';
  return new Error(`OCI vector store request failed: ${method} ${path} returned ${status}: ${details}`);
}

async function ociFetch(path, options = {}) {
  const method = options.method || 'GET';
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    method,
    headers: buildHeaders(options.headers)
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw buildApiError(method, path, response.status, payload);
  }

  return payload;
}

async function postJson(path, body) {
  return ociFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractSearchText(result) {
  if (typeof result?.text === 'string') {
    return result.text;
  }

  if (Array.isArray(result?.content)) {
    return result.content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (typeof item?.text === 'string') {
          return item.text;
        }

        if (typeof item?.text?.value === 'string') {
          return item.text.value;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return '';
}

function normalizeSearchResults(response) {
  const rows = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response?.results)
      ? response.results
      : [];

  return rows
    .map((row, index) => {
      const text = extractSearchText(row);

      return {
        id: row.id || row.file_id || `oci-search-result-${index}`,
        documentId: row.file_id || row.id || null,
        chunkIndex: index,
        text,
        originalName: row.filename || row.file_name || row.file_id || 'OCI vector store result',
        storagePath: null,
        distance: typeof row.score === 'number' ? Math.max(0, 1 - row.score) : null,
        score: typeof row.score === 'number' ? row.score : null
      };
    })
    .filter((row) => row.text);
}

async function uploadFile(file) {
  const buffer = await fs.readFile(file.path);
  const formData = new FormData();
  formData.append('purpose', config.ociVectorStore.filePurpose);
  formData.append('file', new Blob([buffer], { type: file.mimetype || 'application/octet-stream' }), file.originalname);

  return ociFetch('/files', {
    method: 'POST',
    body: formData
  });
}

async function attachFileToVectorStore(fileId) {
  return postJson(`/vector_stores/${encodeURIComponent(config.ociVectorStore.vectorStoreId)}/files`, {
    file_id: fileId
  });
}

async function getVectorStoreFileStatus(vectorStoreFileId) {
  return ociFetch(
    `/vector_stores/${encodeURIComponent(config.ociVectorStore.vectorStoreId)}/files/${encodeURIComponent(vectorStoreFileId)}`
  );
}

async function waitForVectorStoreFile(vectorStoreFile) {
  const vectorStoreFileId = vectorStoreFile.id || vectorStoreFile.file_id;
  const startTime = Date.now();
  let latest = vectorStoreFile;

  while (Date.now() - startTime < config.ociVectorStore.pollTimeoutMs) {
    const status = String(latest.status || '').toLowerCase();

    if (['completed', 'ready', 'processed'].includes(status)) {
      return latest;
    }

    if (['failed', 'cancelled', 'expired'].includes(status)) {
      throw new Error(`OCI vector store file indexing ended with status "${latest.status}".`);
    }

    await sleep(config.ociVectorStore.pollIntervalMs);
    latest = await getVectorStoreFileStatus(vectorStoreFileId);
  }

  throw new Error('Timed out waiting for OCI vector store file indexing.');
}

export async function indexFileInVectorStore(file) {
  assertOciVectorStoreConfig();
  const uploadedFile = await uploadFile(file);
  const fileId = uploadedFile.id;

  if (!fileId) {
    throw new Error('OCI file upload did not return a file id.');
  }

  const vectorStoreFile = await attachFileToVectorStore(fileId);
  const indexedFile = await waitForVectorStoreFile(vectorStoreFile);

  return {
    ociFileId: fileId,
    ociVectorStoreFileId: indexedFile.id || vectorStoreFile.id || vectorStoreFile.file_id || fileId,
    status: indexedFile.status || vectorStoreFile.status || 'completed'
  };
}

export async function searchVectorStore(question, topK) {
  assertOciVectorStoreConfig();
  const safeTopK = Math.max(1, Math.min(Number(topK) || config.rag.topK, 20));
  const response = await postJson(
    `/vector_stores/${encodeURIComponent(config.ociVectorStore.vectorStoreId)}/search`,
    {
      query: question,
      max_num_results: safeTopK,
      rewrite_query: false
    }
  );

  return normalizeSearchResults(response);
}
