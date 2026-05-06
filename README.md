# DocWiser

Small Node.js application that lets you:

- upload a file and store it on local disk
- extract the document text
- index documents in OCI Vector Store
- ask questions against the uploaded documents using LLM + RAG

## Features

- Local file upload with `multer`
- Local disk storage under `uploads/`
- OCI Vector Store indexing for uploaded documents
- Semantic retrieval with OCI Vector Store search
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
- OCI Generative AI Vector Store
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
- `DOCUMENT_STORE_PROVIDER=oci-vector-store`
- `OCI_REGION=your-oci-region`
- `OCI_GENERATIVE_AI_BASE_URL=`
- `OCI_GENERATIVE_AI_API_KEY=your-api-key`
- `OCI_GENERATIVE_AI_PROJECT_ID=your-project-ocid`
- `OCI_VECTOR_STORE_ID=your-vector-store-id`

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
4. The original file is uploaded to OCI Files
5. The uploaded file is attached to the configured OCI Vector Store
6. The app waits for OCI vector-store indexing to complete
7. Suggested questions are generated from the extracted document text

### Question answering flow

1. User asks a question
2. OCI Vector Store search retrieves semantically relevant results
3. Retrieved text is sent to the LLM as context
4. LLM returns the final answer

### Template validation flow

1. User uploads a template document
2. Text is extracted from the template
3. The template file is indexed in OCI Vector Store
4. The LLM converts the template into structured validation rules
5. Template metadata, extracted text, OCI file IDs, and rules are stored in Oracle
6. User selects a template and uploads a document to validate
7. The validation document is indexed in OCI Vector Store
8. The LLM compares the document text against the stored template rules
9. The app stores the validation result metadata in Oracle and returns status, score, issues, and recommendations

## Ollama support

The app now supports Ollama natively:

- chat uses `POST /api/chat`
- embeddings use `POST /api/embed`
- older Ollama versions fall back to `POST /api/embeddings`
- no `OPENAI_API_KEY` is required when `AI_PROVIDER=ollama`

## Oracle schema

The app auto-creates the required Oracle metadata tables on startup:

- `documents`
- `templates`
- `validation_results`

Document embeddings are stored in OCI Vector Store, not Oracle Database.

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
5. Verify the answer and retrieved OCI vector-store sources
