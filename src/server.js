import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { config, normalizeDocumentStoreProvider, validateConfig } from './config.js';
import { closeOracle, initializeOracle } from './db/oracle.js';
import { isSupportedFile } from './services/documentParser.js';
import {
  answerQuestion,
  ingestDocument,
  listDocuments,
  suggestQuestionsForDocument,
  summarizeDocument
} from './services/ragService.js';
import {
  ingestTemplate,
  listTemplates,
  validateDocumentAgainstTemplate
} from './services/templateService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const publicDir = path.resolve(__dirname, '../public');

function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, config.uploadDir);
  },
  filename: (_request, file, callback) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadBytes
  },
  fileFilter: (_request, file, callback) => {
    if (isSupportedFile(file.originalname, file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(new Error('Unsupported file type. Use PDF, DOCX, TXT, MD, CSV, or JSON.'));
  }
});

function resolveDocumentStoreProvider(value) {
  return normalizeDocumentStoreProvider(value || config.documentStore.provider);
}

function resolveNumberOption(value, fallback, { min, max }) {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.max(min, Math.min(parsedValue, max));
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/api/documents', async (_request, response) => {
  try {
    const documents = await listDocuments();
    response.json({ documents });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Failed to load documents.' });
  }
});

app.post('/api/upload', upload.single('document'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const result = await ingestDocument(
      request.file,
      resolveDocumentStoreProvider(request.body?.documentStoreProvider)
    );
    response.status(201).json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Upload failed.' });
  }
});

app.get('/api/templates', async (_request, response) => {
  try {
    const templates = await listTemplates();
    response.json({ templates });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Failed to load templates.' });
  }
});

app.post('/api/templates', upload.single('template'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No template uploaded.' });
      return;
    }

    const result = await ingestTemplate(
      request.file,
      resolveDocumentStoreProvider(request.body?.documentStoreProvider)
    );
    response.status(201).json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Template upload failed.' });
  }
});

app.post('/api/validate', upload.single('document'), async (request, response) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'No document uploaded.' });
      return;
    }

    const result = await validateDocumentAgainstTemplate(
      request.body?.templateId,
      request.file,
      resolveDocumentStoreProvider(request.body?.documentStoreProvider)
    );
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Template validation failed.' });
  }
});

app.post('/api/ask', async (request, response) => {
  try {
    const question = String(request.body?.question || '').trim();
    const documentId = request.body?.documentId ? Number(request.body.documentId) : null;

    if (!question) {
      response.status(400).json({ error: 'Question is required.' });
      return;
    }

    const result = await answerQuestion(
      question,
      request.body?.topK,
      documentId,
      resolveDocumentStoreProvider(request.body?.documentStoreProvider),
      {
        temperature: resolveNumberOption(request.body?.temperature, config.ai.temperature, {
          min: 0,
          max: 2
        }),
        topP: resolveNumberOption(request.body?.topP, config.ai.topP, {
          min: 0,
          max: 1
        })
      }
    );
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Question answering failed.' });
  }
});

app.get('/api/suggested-questions', async (request, response) => {
  try {
    const documentId = request.query?.documentId ? Number(request.query.documentId) : null;
    const limit = Number(request.query?.limit || 3);
    const result = await suggestQuestionsForDocument(documentId, limit);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Failed to load suggested questions.' });
  }
});

app.get('/api/document-summary', async (request, response) => {
  try {
    const documentId = request.query?.documentId ? Number(request.query.documentId) : null;
    const result = await summarizeDocument(documentId);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error.message || 'Failed to load document summary.' });
  }
});

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ error: error.message });
    return;
  }

  response.status(500).json({ error: error.message || 'Unexpected server error.' });
});

async function start() {
  validateConfig();
  ensureUploadDir();
  await initializeOracle();

  app.listen(config.port, () => {
    console.log(`Oracle RAG app is running at http://localhost:${config.port}`);
  });
}

async function shutdown(signal) {
  try {
    console.log(`Received ${signal}. Shutting down gracefully...`);
    await closeOracle();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch((error) => {
    console.error('Error during shutdown:', error);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch((error) => {
    console.error('Error during shutdown:', error);
    process.exit(1);
  });
});

start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
