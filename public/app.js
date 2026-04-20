const uploadForm = document.getElementById('upload-form');
const askForm = document.getElementById('ask-form');
const uploadStatus = document.getElementById('upload-status');
const askStatus = document.getElementById('ask-status');
const answerEl = document.getElementById('answer');
const sourcesEl = document.getElementById('sources');
const documentsEl = document.getElementById('documents');
const refreshDocumentsButton = document.getElementById('refresh-documents');

function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? '#fca5a5' : '#93c5fd';
}

function renderDocuments(documents) {
  if (!documents || documents.length === 0) {
    documentsEl.innerHTML = '<li class="document-item muted">No documents indexed yet.</li>';
    return;
  }

  documentsEl.innerHTML = documents
    .map(
      (document) => `
        <li class="document-item">
          <strong>${document.ORIGINAL_NAME}</strong><br />
          <span class="muted">Status: ${document.STATUS}</span><br />
          <span class="muted">Chunks: ${document.CHUNK_COUNT}</span><br />
          <span class="muted">Stored: ${document.STORAGE_PATH}</span>
          ${document.ERROR_MESSAGE ? `<br /><span style="color:#fca5a5;">Error: ${document.ERROR_MESSAGE}</span>` : ''}
        </li>
      `
    )
    .join('');
}

function renderSources(citations = []) {
  if (citations.length === 0) {
    sourcesEl.innerHTML = '<li class="source-item muted">No sources returned.</li>';
    return;
  }

  sourcesEl.innerHTML = citations
    .map(
      (citation) => `
        <li class="source-item">
          <strong>${citation.fileName}</strong><br />
          Chunk: ${citation.chunkIndex}<br />
          Score: ${citation.score ?? 'n/a'}
        </li>
      `
    )
    .join('');
}

async function loadDocuments() {
  try {
    const response = await fetch('/api/documents');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load documents.');
    }

    renderDocuments(payload.documents || []);
  } catch (error) {
    documentsEl.innerHTML = `<li class="document-item" style="color:#fca5a5;">${error.message}</li>`;
  }
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById('document');
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus(uploadStatus, 'Choose a file first.', true);
    return;
  }

  const formData = new FormData();
  formData.append('document', file);

  setStatus(uploadStatus, 'Uploading and indexing document...');

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Upload failed.');
    }

    setStatus(uploadStatus, `Indexed ${payload.originalName} with ${payload.chunkCount} chunks.`);
    fileInput.value = '';
    await loadDocuments();
  } catch (error) {
    setStatus(uploadStatus, error.message, true);
  }
});

askForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const question = document.getElementById('question').value.trim();
  const topK = Number(document.getElementById('topk').value || 4);

  if (!question) {
    setStatus(askStatus, 'Enter a question first.', true);
    return;
  }

  setStatus(askStatus, 'Searching chunks and asking the LLM...');
  answerEl.textContent = 'Loading...';
  sourcesEl.innerHTML = '';

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ question, topK })
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Question answering failed.');
    }

    answerEl.textContent = payload.answer || 'No answer returned.';
    renderSources(payload.citations || []);
    setStatus(askStatus, 'Done.');
  } catch (error) {
    answerEl.textContent = 'Failed to get an answer.';
    renderSources([]);
    setStatus(askStatus, error.message, true);
  }
});

refreshDocumentsButton.addEventListener('click', () => {
  loadDocuments();
});

loadDocuments();
