const uploadForm = document.getElementById('upload-form');
const askForm = document.getElementById('ask-form');
const templateForm = document.getElementById('template-form');
const validateForm = document.getElementById('validate-form');
const uploadStatus = document.getElementById('upload-status');
const askStatus = document.getElementById('ask-status');
const templateStatus = document.getElementById('template-status');
const validationStatus = document.getElementById('validation-status');
const answerEl = document.getElementById('answer');
const validationResultEl = document.getElementById('validation-result');
const documentSummaryEl = document.getElementById('document-summary');
const sourcesEl = document.getElementById('sources');
const documentsEl = document.getElementById('documents');
const templateSelect = document.getElementById('template-select');
const suggestedQuestionsPanel = document.getElementById('suggested-questions-panel');
const suggestedQuestionsEl = document.getElementById('suggested-questions');
const suggestedQuestionsStatus = document.getElementById('suggested-questions-status');
const sortDocumentsButton = document.getElementById('sort-documents');
const menuToggle = document.getElementById('menu-toggle');
const pageMenu = document.getElementById('page-menu');
const navLinks = Array.from(document.querySelectorAll('[data-page]'));
const pagePanels = Array.from(document.querySelectorAll('[data-page-panel]'));
const selectedDocumentEl = document.getElementById('selected-document');
const uploadLoader = document.getElementById('upload-loader');
const suggestedQuestionsLoader = document.getElementById('suggested-questions-loader');
const documentInput = document.getElementById('document');
const questionInput = document.getElementById('question');
const documentStoreProviderInput = document.getElementById('document-store-provider');
const validationStoreProviderInput = document.getElementById('validation-store-provider');
let latestDocumentId = null;
let latestDocuments = [];
let documentSortMode = 'uploaded-date';

function setStatus(element, text, isError = false) {
  element.textContent = text;
  element.style.color = isError ? '#fca5a5' : '#93c5fd';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCreatedAt(value) {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString();
}

function formatSummaryLine(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return text.replace(/^here is a summary of the document[^:]*:?\s*/i, 'Summary: ');
}

function getProviderLabel(provider) {
  return provider === 'oracle-db' ? 'Local Oracle DB' : 'OCI Vector Store';
}

function getDocumentCreatedAtMs(document) {
  const date = new Date(document.CREATED_AT);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getSortedDocuments(documents) {
  return [...documents].sort((left, right) => {
    if (documentSortMode === 'name') {
      const nameComparison = String(left.ORIGINAL_NAME || '').localeCompare(
        String(right.ORIGINAL_NAME || ''),
        undefined,
        { sensitivity: 'base' }
      );

      if (nameComparison !== 0) {
        return nameComparison;
      }
    }

    const dateComparison = getDocumentCreatedAtMs(right) - getDocumentCreatedAtMs(left);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return String(left.ORIGINAL_NAME || '').localeCompare(String(right.ORIGINAL_NAME || ''), undefined, {
      sensitivity: 'base'
    });
  });
}

function updateDocumentSortButton() {
  sortDocumentsButton.value = documentSortMode;
}

function setActivePage(pageName, updateHash = true) {
  const targetPage = pagePanels.some((panel) => panel.dataset.pagePanel === pageName)
    ? pageName
    : 'home';

  pagePanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.pagePanel === targetPage);
  });

  navLinks.forEach((link) => {
    const isActive = link.dataset.page === targetPage;
    link.classList.toggle('active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  pageMenu.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');

  if (updateHash) {
    window.history.replaceState(null, '', targetPage === 'home' ? '#' : `#${targetPage}`);
  }
}

menuToggle.addEventListener('click', () => {
  const isOpen = pageMenu.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});

document.addEventListener('click', (event) => {
  const clickedInsideMenu = pageMenu.contains(event.target);
  const clickedToggle = menuToggle.contains(event.target);

  if (!clickedInsideMenu && !clickedToggle) {
    pageMenu.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  }
});

navLinks.forEach((link) => {
  link.addEventListener('click', () => {
    setActivePage(link.dataset.page);
  });
});

window.addEventListener('hashchange', () => {
  setActivePage(window.location.hash.replace('#', ''), false);
});

function renderDocuments(documents) {
  if (!documents || documents.length === 0) {
    documentsEl.innerHTML = '<li class="document-item muted">No documents indexed yet.</li>';
    return;
  }

  documentsEl.innerHTML = documents
    .map(
      (document) => {
        const storeProvider = document.DOCUMENT_STORE_PROVIDER || 'oci-vector-store';
        const rawSummary = document.SHORT_DESCRIPTION || document.SUMMARY_TEXT || 'Summary pending.';
        const summaryText = formatSummaryLine(rawSummary);
        const indexLabel = storeProvider === 'oci-vector-store'
          ? `OCI file: ${document.OCI_FILE_ID || 'pending'}`
          : `Chunks: ${document.CHUNK_COUNT}`;
        const activeClass = Number(document.ID) === latestDocumentId ? ' active' : '';

        return `
          <li class="document-item selectable${activeClass}" data-document-id="${escapeHtml(document.ID)}" data-document-name="${escapeHtml(document.ORIGINAL_NAME)}" data-document-provider="${escapeHtml(storeProvider)}">
            <strong>${escapeHtml(document.ORIGINAL_NAME)}</strong><br />
            <span class="document-summary-line">${escapeHtml(summaryText)}</span><br />
            <span class="muted">Status: ${escapeHtml(document.STATUS)}</span><br />
            <span class="muted">Provider: ${escapeHtml(getProviderLabel(storeProvider))}</span><br />
            <span class="muted">${escapeHtml(indexLabel)}</span><br />
            <span class="muted">Uploaded at: ${escapeHtml(formatCreatedAt(document.CREATED_AT))}</span><br />
            ${document.ERROR_MESSAGE ? `<br /><span style="color:#fca5a5;">Error: ${escapeHtml(document.ERROR_MESSAGE)}</span>` : ''}
          </li>
        `;
      }
    )
    .join('');
}

function resetQuestionAndAnswer() {
  questionInput.value = '';
  answerEl.textContent = 'No answer yet.';
  sourcesEl.innerHTML = '';
  askStatus.textContent = '';
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
          <strong>${escapeHtml(citation.fileName)}</strong><br />
          Chunk: ${escapeHtml(citation.chunkIndex)}<br />
          Score: ${escapeHtml(citation.score ?? 'n/a')}
        </li>
      `
    )
    .join('');
}

function renderSuggestedQuestions(questions = [], options = {}) {
  const {
    showEmptyState = false,
    emptyMessage = 'No suggested questions available for this document.'
  } = options;
  const usableQuestions = questions
    .map((question) => String(question || '').trim())
    .filter(Boolean)
    .slice(0, 5);

  if (usableQuestions.length === 0) {
    suggestedQuestionsEl.innerHTML = '';

    if (showEmptyState) {
      suggestedQuestionsPanel.classList.remove('hidden');
      suggestedQuestionsStatus.textContent = emptyMessage;
      suggestedQuestionsStatus.classList.remove('hidden');
      suggestedQuestionsStatus.style.color = '#93c5fd';
    } else {
      suggestedQuestionsPanel.classList.add('hidden');
      suggestedQuestionsStatus.textContent = '';
      suggestedQuestionsStatus.classList.add('hidden');
    }
    return;
  }

  suggestedQuestionsPanel.classList.remove('hidden');
  suggestedQuestionsStatus.textContent = '';
  suggestedQuestionsStatus.classList.add('hidden');
  suggestedQuestionsEl.innerHTML = usableQuestions
    .map(
      (question) => `
        <button class="suggested-question" type="button" data-question="${escapeHtml(question)}">
          ${escapeHtml(question)}
        </button>
      `
    )
    .join('');
}

function parseTemplateRules(value) {
  if (typeof value === 'object' && value !== null) {
    return value;
  }

  try {
    return JSON.parse(String(value || '{}'));
  } catch (_error) {
    return {};
  }
}

function renderTemplates(templates) {
  if (!templates || templates.length === 0) {
    templateSelect.innerHTML = '<option value="">No templates uploaded yet</option>';
    return;
  }

  templateSelect.innerHTML = [
    '<option value="">Choose a template...</option>',
    ...templates.map((template) => {
      const rules = parseTemplateRules(template.RULES_JSON);
      const summary = rules?.summary ? ` - ${rules.summary}` : '';

      return `<option value="${escapeHtml(template.ID)}">${escapeHtml(template.ORIGINAL_NAME)}${escapeHtml(summary)}</option>`;
    })
  ].join('');
}

function formatValidationItem(item) {
  if (typeof item === 'string') {
    return escapeHtml(item);
  }

  if (!item || typeof item !== 'object') {
    return escapeHtml(String(item ?? ''));
  }

  const title = item.requirement || item.field || item.section || item.rule || item.check || 'Item';
  const detailParts = [
    item.reason ? `Reason: ${item.reason}` : '',
    item.evidence ? `Evidence: ${item.evidence}` : ''
  ].filter(Boolean);

  if (detailParts.length === 0) {
    return escapeHtml(title);
  }

  return `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(detailParts.join(' | '))}</span>
  `;
}

function renderValidationList(title, items = [], emptyText) {
  if (!items || items.length === 0) {
    return `
      <section class="validation-section">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">${escapeHtml(emptyText)}</p>
      </section>
    `;
  }

  return `
    <section class="validation-section">
      <h3>${escapeHtml(title)}</h3>
      <ul>
        ${items.map((item) => `<li>${formatValidationItem(item)}</li>`).join('')}
      </ul>
    </section>
  `;
}

function renderValidationResult(payload) {
  const result = payload?.result;

  if (!result) {
    validationResultEl.textContent = 'No validation result returned.';
    return;
  }

  const statusClass = `validation-status-badge validation-${escapeHtml(result.status || 'warning')}`;

  validationResultEl.innerHTML = `
    <div class="validation-summary">
      <div>
        <p class="muted">Template</p>
        <strong>${escapeHtml(payload.templateName)}</strong>
      </div>
      <div>
        <p class="muted">Document</p>
        <strong>${escapeHtml(payload.documentName)}</strong>
      </div>
      <div>
        <p class="muted">Status</p>
        <span class="${statusClass}">${escapeHtml(result.status || 'warning')}</span>
      </div>
      <div>
        <p class="muted">Provider</p>
        <strong>${escapeHtml(getProviderLabel(payload.documentStoreProvider))}</strong>
      </div>
      <div>
        <p class="muted">Score</p>
        <strong>${escapeHtml(result.score ?? 'n/a')}/100</strong>
      </div>
    </div>

    <section class="validation-section">
      <h3>Missing detail summary</h3>
      <p>${escapeHtml(result.summary || 'The validator did not provide a summary.')}</p>
    </section>

    ${renderValidationList('Missing required checks', result.failedChecks, 'No missing required checks reported.')}
    ${renderValidationList('Possible missing details', result.warnings, 'No possible missing details reported.')}
    ${renderValidationList('Missing fields', result.missingFields, 'No missing fields reported.')}
    ${renderValidationList('Missing sections', result.sectionIssues, 'No missing sections reported.')}
    ${renderValidationList('Present required details', result.passedChecks, 'No present details reported.')}
    ${renderValidationList('Recommendations', result.recommendations, 'No recommendations returned.')}
  `;
}

function summarizeValidation(result) {
  const issueCount = [
    ...(result.failedChecks || []),
    ...(result.warnings || []),
    ...(result.missingFields || []),
    ...(result.sectionIssues || [])
  ].length;
  const issueText = issueCount === 1 ? '1 issue' : `${issueCount} issues`;
  const summary = result.summary ? ` ${result.summary}` : '';

  return `Validation complete: ${result.status} (${result.score}/100), ${issueText} found.${summary}`;
}

async function loadDocuments() {
  try {
    const response = await fetch('/api/documents');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load documents.');
    }

    latestDocuments = payload.documents || [];
    renderDocuments(getSortedDocuments(latestDocuments));
  } catch (error) {
    documentsEl.innerHTML = `<li class="document-item" style="color:#fca5a5;">${error.message}</li>`;
  }
}

async function loadSuggestedQuestionsForDocument(documentId) {
  if (!documentId) {
    renderSuggestedQuestions([]);
    return;
  }

  suggestedQuestionsPanel.classList.remove('hidden');
  suggestedQuestionsStatus.textContent = 'Loading suggested questions...';
  suggestedQuestionsStatus.classList.remove('hidden');
  suggestedQuestionsEl.innerHTML = '';
  suggestedQuestionsLoader.classList.remove('hidden');

  try {
    const response = await fetch(`/api/suggested-questions?documentId=${documentId}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load suggested questions.');
    }

    renderSuggestedQuestions(payload.questions || [], {
      showEmptyState: true,
      emptyMessage: 'No suggested questions are available for this document yet.'
    });
  } catch (error) {
    setStatus(askStatus, error.message, true);
    renderSuggestedQuestions([], {
      showEmptyState: true,
      emptyMessage: 'Unable to load suggested questions right now.'
    });
  } finally {
    suggestedQuestionsLoader.classList.add('hidden');
    suggestedQuestionsStatus.textContent = '';
    suggestedQuestionsStatus.classList.add('hidden');
  }
}

async function loadSummaryForDocument(documentId) {
  if (!documentId) {
    documentSummaryEl.textContent = 'Upload a document to see its summary.';
    return;
  }

  documentSummaryEl.textContent = 'Loading summary...';

  try {
    const response = await fetch(`/api/document-summary?documentId=${documentId}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load document summary.');
    }

    documentSummaryEl.textContent = payload.summary || 'No summary was generated.';
  } catch (error) {
    documentSummaryEl.textContent = `Summary unavailable: ${error.message}`;
  }
}

async function loadTemplates() {
  try {
    const response = await fetch('/api/templates');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to load templates.');
    }

    renderTemplates(payload.templates || []);
  } catch (error) {
    templateSelect.innerHTML = '<option value="">Failed to load templates</option>';
    setStatus(templateStatus, error.message, true);
  }
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = documentInput.files?.[0];

  if (!file) {
    setStatus(uploadStatus, 'Choose a file first.', true);
    return;
  }

  const formData = new FormData();
  formData.append('document', file);
  formData.append('documentStoreProvider', documentStoreProviderInput.value);

  setStatus(uploadStatus, `Uploading and indexing document in ${getProviderLabel(documentStoreProviderInput.value)}...`);
  uploadLoader.classList.remove('hidden');
  suggestedQuestionsPanel.classList.remove('hidden');
  suggestedQuestionsStatus.textContent = 'Preparing suggested questions...';
  suggestedQuestionsStatus.classList.remove('hidden');
  suggestedQuestionsEl.innerHTML = '';
  suggestedQuestionsLoader.classList.remove('hidden');
  documentSummaryEl.textContent = 'Generating summary...';
  resetQuestionAndAnswer();

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Upload failed.');
    }

    setStatus(uploadStatus, `Indexed ${payload.originalName} in ${getProviderLabel(payload.documentStoreProvider)}.`);
    renderSuggestedQuestions(payload.suggestedQuestions || []);
    documentSummaryEl.textContent = payload.summary || 'No summary was generated.';
    suggestedQuestionsLoader.classList.add('hidden');
    suggestedQuestionsStatus.textContent = '';
    suggestedQuestionsStatus.classList.add('hidden');

    if (payload.suggestionError) {
      setStatus(
        uploadStatus,
        `Indexed ${payload.originalName} in ${getProviderLabel(payload.documentStoreProvider)}, but suggested questions could not be generated: ${payload.suggestionError}`
      );
    }

    if (payload.summaryError) {
      documentSummaryEl.textContent = `Summary unavailable: ${payload.summaryError}`;
    }

    documentInput.value = '';
    latestDocumentId = payload.documentId || null;
    selectedDocumentEl.textContent = latestDocumentId
      ? `Selected: ${payload.originalName}`
      : 'Selected: No file selected';
    if (!payload.suggestedQuestions || payload.suggestedQuestions.length === 0) {
      await loadSuggestedQuestionsForDocument(latestDocumentId);
    }
    await loadDocuments();
  } catch (error) {
    setStatus(uploadStatus, error.message, true);
    documentSummaryEl.textContent = 'Summary unavailable due to upload error.';
    suggestedQuestionsLoader.classList.add('hidden');
    suggestedQuestionsStatus.textContent = '';
    suggestedQuestionsStatus.classList.add('hidden');
  } finally {
    uploadLoader.classList.add('hidden');
  }
});

documentInput.addEventListener('change', () => {
  const hasFile = documentInput.files?.length > 0;

  if (!hasFile) {
    return;
  }

  suggestedQuestionsPanel.classList.add('hidden');
  suggestedQuestionsStatus.textContent = '';
  suggestedQuestionsStatus.classList.add('hidden');
  suggestedQuestionsEl.innerHTML = '';
  resetQuestionAndAnswer();
});

suggestedQuestionsEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-question]');

  if (!button) {
    return;
  }

  askQuestion(button.dataset.question);
});

templateForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const fileInput = document.getElementById('template');
  const file = fileInput.files?.[0];

  if (!file) {
    setStatus(templateStatus, 'Choose a template file first.', true);
    return;
  }

  const formData = new FormData();
  formData.append('template', file);
  formData.append('documentStoreProvider', validationStoreProviderInput.value);

  setStatus(templateStatus, `Uploading template, indexing in ${getProviderLabel(validationStoreProviderInput.value)}, and extracting validation rules...`);

  try {
    const response = await fetch('/api/templates', {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Template upload failed.');
    }

    setStatus(templateStatus, `Template ready: ${payload.originalName} indexed in ${getProviderLabel(payload.documentStoreProvider)}.`);
    fileInput.value = '';
    await loadTemplates();
    templateSelect.value = String(payload.templateId);
  } catch (error) {
    setStatus(templateStatus, error.message, true);
  }
});

validateForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const templateId = templateSelect.value;
  const fileInput = document.getElementById('validation-document');
  const file = fileInput.files?.[0];

  if (!templateId) {
    setStatus(validationStatus, 'Choose a template first.', true);
    return;
  }

  if (!file) {
    setStatus(validationStatus, 'Choose a document to validate.', true);
    return;
  }

  const formData = new FormData();
  formData.append('templateId', templateId);
  formData.append('document', file);
  formData.append('documentStoreProvider', validationStoreProviderInput.value);

  setStatus(validationStatus, `Indexing document in ${getProviderLabel(validationStoreProviderInput.value)} and validating against template...`);
  validationResultEl.textContent = 'Loading...';

  try {
    const response = await fetch('/api/validate', {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Template validation failed.');
    }

    renderValidationResult(payload);
    setStatus(validationStatus, summarizeValidation(payload.result));
    fileInput.value = '';
  } catch (error) {
    validationResultEl.textContent = 'Failed to validate document.';
    setStatus(validationStatus, error.message, true);
  }
});

async function askQuestion(questionValue) {
  const questionInput = document.getElementById('question');
  const question = String(questionValue ?? questionInput.value).trim();
  const topK = Number(document.getElementById('topk').value || 4);
  const temperature = Number(document.getElementById('temperature').value || 0.2);
  const topP = Number(document.getElementById('top-p').value || 0.9);

  if (!question) {
    setStatus(askStatus, 'Enter a question first.', true);
    return;
  }

  if (!latestDocumentId) {
    setStatus(askStatus, 'Upload a document before asking a question.', true);
    return;
  }

  questionInput.value = question;
  setStatus(askStatus, 'Searching chunks and asking the LLM...');
  answerEl.textContent = 'Loading...';
  sourcesEl.innerHTML = '';

  try {
    const response = await fetch('/api/ask', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        question,
        topK,
        temperature,
        topP,
        documentId: latestDocumentId,
        documentStoreProvider: documentStoreProviderInput.value
      })
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
}

askForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await askQuestion();
});

sortDocumentsButton.addEventListener('change', () => {
  documentSortMode = sortDocumentsButton.value;
  updateDocumentSortButton();
  renderDocuments(getSortedDocuments(latestDocuments));
});

documentsEl.addEventListener('click', (event) => {
  const item = event.target.closest('.document-item.selectable');

  if (!item) {
    return;
  }

  const documentId = Number(item.dataset.documentId);
  const documentName = item.dataset.documentName || 'Selected document';
  const documentProvider = item.dataset.documentProvider || 'oci-vector-store';

  if (!Number.isFinite(documentId)) {
    return;
  }

  latestDocumentId = documentId;
  documentStoreProviderInput.value = documentProvider;
  selectedDocumentEl.textContent = `Selected: ${documentName}`;
  resetQuestionAndAnswer();
  loadSuggestedQuestionsForDocument(latestDocumentId);
  loadSummaryForDocument(latestDocumentId);
  documentsEl.querySelectorAll('.document-item.selectable').forEach((row) => {
    row.classList.toggle('active', row === item);
  });
});

setActivePage(window.location.hash.replace('#', ''), false);
loadDocuments();
loadTemplates();
selectedDocumentEl.textContent = 'Selected: No file selected';
updateDocumentSortButton();
uploadLoader.classList.add('hidden');
suggestedQuestionsLoader.classList.add('hidden');
