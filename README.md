# DocWiser

Small Node.js application that lets you:

- upload a file and store it on local disk
- extract the document text
- create embeddings
- store chunks + vectors in Oracle Database 23.3/23ai
- ask questions against the uploaded documents using LLM + RAG

## Features

- Local file upload with `multer`
- Local disk storage under `uploads/`
- Oracle vector storage using `VECTOR(...)`
- Retrieval with `VECTOR_DISTANCE(..., COSINE)`
- Ollama and OpenAI-compatible embeddings + chat API support
- Template upload and LLM-based document validation
- Simple browser UI

## Supported file types

- `.pdf`
- `.docx`
- `.txt`
- `.md`
- `.csv`
- `.json`

## Project structure

```text
oracle-rag-app/
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── db/oracle.js
│   ├── services/aiClient.js
│   ├── services/chunking.js
│   ├── services/documentParser.js
│   ├── services/ragService.js
│   ├── config.js
│   └── server.js
├── .env.example
├── package.json
└── README.md
```

## Prerequisites

- Node.js 18+
- Oracle Database 23.3 / 23ai running locally
- Ollama installed locally for the default setup, or another compatible LLM endpoint

Examples:

- Ollama
- OpenAI
- LM Studio server
- vLLM / LiteLLM / other OpenAI-compatible servers

## Setup

### 1. Install dependencies

```bash
cd /Users/amutyala/Desktop/oracle-rag-app
npm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

Update `.env` with your values.

Important settings:

- `ORACLE_CONNECT_STRING=localhost:1521/FREEPDB1`
- `ORACLE_USER=system`
- `ORACLE_PASSWORD=your_password`
- `AI_PROVIDER=ollama`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `EMBEDDING_MODEL=llama3.1`
- `CHAT_MODEL=llama3.1`
- `EMBEDDING_DIMENSION=4096`

If you later switch back to OpenAI, set `AI_PROVIDER=openai`, configure `OPENAI_BASE_URL`, add `OPENAI_API_KEY`, and update `EMBEDDING_DIMENSION` to match the embedding model.

### 3. Start the app

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## How it works

### Upload flow

1. User uploads a document from the browser
2. File is saved in local disk under `uploads/`
3. Text is extracted from the file
4. Text is split into chunks
5. Embeddings are generated for each chunk
6. Chunks and vectors are stored in Oracle

### Question answering flow

1. User asks a question
2. Question embedding is generated
3. Oracle retrieves the nearest chunks using vector search
4. Retrieved chunks are sent to the LLM as context
5. LLM returns the final answer

### Template validation flow

1. User uploads a template document
2. Text is extracted from the template
3. The LLM converts the template into structured validation rules
4. The template and rules are stored in Oracle
5. User selects a template and uploads a document to validate
6. The LLM compares the document text against the stored rules
7. The app returns a validation status, score, issues, and recommendations

## Ollama support

The app now supports Ollama natively:

- chat uses `POST /api/chat`
- embeddings use `POST /api/embed`
- older Ollama versions fall back to `POST /api/embeddings`
- no `OPENAI_API_KEY` is required when `AI_PROVIDER=ollama`

## Oracle schema

The app auto-creates the required tables on startup:

- `documents`
- `document_chunks`
- `templates`
- `validation_results`

The vector column is created like this:

```sql
embedding VECTOR(<EMBEDDING_DIMENSION>, FLOAT32)
```

So `EMBEDDING_DIMENSION` in `.env` must match your embedding model.

For the current local setup in this repo:

- `llama3.1` embeddings return dimension `4096`

### Important note about dimension changes

If you already started the app once and later change `EMBEDDING_DIMENSION`, you should recreate the `document_chunks` table or start with a fresh schema.

## Example local Oracle connection strings

- `localhost:1521/FREEPDB1`
- `127.0.0.1:1521/FREEPDB1`

## API endpoints

### Upload document

```http
POST /api/upload
Content-Type: multipart/form-data
field name: document
```

### Ask question

```http
POST /api/ask
Content-Type: application/json

{
  "question": "What is this document about?",
  "topK": 4
}
```

### List indexed documents

```http
GET /api/documents
```

### Upload template

```http
POST /api/templates
Content-Type: multipart/form-data
field name: template
```

### List templates

```http
GET /api/templates
```

### Validate document against template

```http
POST /api/validate
Content-Type: multipart/form-data
fields:
  templateId
  document
```

## Notes

- This is a simple starter implementation.
- For production, add authentication, streaming responses, better chunking, retry logic, and vector indexes.
- For large documents, consider background jobs instead of processing during the request.

## Quick test

1. Start the server
2. Upload one PDF/TXT/DOCX file
3. Wait until the document status becomes `ready`
4. Ask a question related to the file
5. Verify the answer and retrieved source chunks
