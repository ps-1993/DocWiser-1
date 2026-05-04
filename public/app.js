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
const sourcesEl = document.getElementById('sources');
const documentsEl = document.getElementById('documents');
const templateSelect = document.getElementById('template-select');
const refreshDocumentsButton = document.getElementById('refresh-documents');
const menuToggle = document.getElementById('menu-toggle');
const pageMenu = document.getElementById('page-menu');
const navLinks = Array.from(document.querySelectorAll('[data-page]'));
const pagePanels = Array.from(document.querySelectorAll('[data-page-panel]'));

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
      (document) => `
        <li class="document-item">
          <strong>${escapeHtml(document.ORIGINAL_NAME)}</strong><br />
          <span class="muted">Status: ${escapeHtml(document.STATUS)}</span><br />
          <span class="muted">Chunks: ${escapeHtml(document.CHUNK_COUNT)}</span><br />
          <span class="muted">Stored: ${escapeHtml(document.STORAGE_PATH)}</span>
          ${document.ERROR_MESSAGE ? `<br /><span style="color:#fca5a5;">Error: ${escapeHtml(document.ERROR_MESSAGE)}</span>` : ''}
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
          <strong>${escapeHtml(citation.fileName)}</strong><br />
          Chunk: ${escapeHtml(citation.chunkIndex)}<br />
          Score: ${escapeHtml(citation.score ?? 'n/a')}
        </li>
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

    renderDocuments(payload.documents || []);
  } catch (error) {
    documentsEl.innerHTML = `<li class="document-item" style="color:#fca5a5;">${error.message}</li>`;
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

  setStatus(templateStatus, 'Uploading template and extracting validation rules...');

  try {
    const response = await fetch('/api/templates', {
      method: 'POST',
      body: formData
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || 'Template upload failed.');
    }

    setStatus(templateStatus, `Template ready: ${payload.originalName}`);
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

  setStatus(validationStatus, 'Validating document against template...');
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

setActivePage(window.location.hash.replace('#', ''), false);
loadDocuments();
loadTemplates();
