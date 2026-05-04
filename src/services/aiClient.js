import { config } from '../config.js';

function buildHeaders() {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.ai.apiKey) {
    headers.Authorization = `Bearer ${config.ai.apiKey}`;
  }

  return headers;
}

function buildApiError(status, details, model) {
  const prefix = `AI API request failed (${status}) via ${config.ai.provider}`;

  if (
    config.ai.provider === 'ollama' &&
    /model\s+"[^"]+"\s+not found/i.test(details)
  ) {
    return new Error(`${prefix}: ${details}. Run: ollama pull ${model}`);
  }

  return new Error(`${prefix}: ${details}`);
}

function isMissingOllamaEndpointError(error) {
  const message = String(error?.message || '');
  return /404 page not found/i.test(message);
}

function normalizeOllamaEmbeddings(response) {
  if (Array.isArray(response?.embeddings)) {
    return response.embeddings;
  }

  if (Array.isArray(response?.embedding)) {
    return [response.embedding];
  }

  return [];
}

async function postJson(path, payload) {
  let response;

  try {
    response = await fetch(`${config.ai.baseUrl}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(payload)
    });
  } catch (error) {
    throw new Error(
      `Failed to reach ${config.ai.provider} at ${config.ai.baseUrl}: ${error.message}`
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw buildApiError(response.status, errorText, payload?.model);
  }

  return response.json();
}

async function generateChatCompletion(messages, options = {}) {
  const temperature = options.temperature ?? config.ai.temperature;

  if (config.ai.provider === 'ollama') {
    const response = await postJson('/api/chat', {
      model: config.ai.chatModel,
      messages,
      stream: false,
      options: {
        temperature
      }
    });

    return response.message?.content?.trim() || 'No answer returned by the LLM.';
  }

  const response = await postJson('/chat/completions', {
    model: config.ai.chatModel,
    temperature,
    messages
  });

  return response.choices?.[0]?.message?.content?.trim() || 'No answer returned by the LLM.';
}

function extractJsonObject(text) {
  const trimmed = String(text || '').trim();

  if (!trimmed) {
    throw new Error('The LLM returned an empty response.');
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (fencedMatch) {
      return JSON.parse(fencedMatch[1].trim());
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw _error;
  }
}

function truncateText(text, maxChars) {
  const normalized = String(text || '').trim();

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars)}\n\n[Text truncated to ${maxChars} characters.]`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function mentionsDisallowedValidation(reason) {
  return /\b(grammar|grammatical|syntax|spelling|typo|misspell|punctuation|capitalization|capitalisation|style|tone|wording|proofread|proofreading|incorrect title)\b/i.test(
    String(reason || '')
  );
}

function removeDisallowedValidationItems(items) {
  return normalizeArray(items).filter((item) => {
    if (typeof item === 'string') {
      return !mentionsDisallowedValidation(item);
    }

    const reason = `${item?.requirement || ''} ${item?.field || ''} ${item?.section || ''} ${item?.rule || ''} ${item?.reason || ''}`;
    return !mentionsDisallowedValidation(reason);
  });
}

function assertEmbeddingDimensions(embeddings) {
  embeddings.forEach((embedding, index) => {
    if (!Array.isArray(embedding)) {
      throw new Error(`Embedding at index ${index} is not an array.`);
    }

    if (embedding.length !== config.rag.embeddingDimension) {
      throw new Error(
        `Embedding at index ${index} has dimension ${embedding.length}, expected ${config.rag.embeddingDimension}.`
      );
    }
  });
}

export async function embedTexts(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  if (config.ai.provider === 'ollama') {
    try {
      const response = await postJson('/api/embed', {
        model: config.ai.embeddingModel,
        input: texts
      });

      const embeddings = normalizeOllamaEmbeddings(response);
      assertEmbeddingDimensions(embeddings);
      return embeddings;
    } catch (error) {
      if (!isMissingOllamaEndpointError(error)) {
        throw error;
      }
    }

    const embeddings = [];

    for (const text of texts) {
      const response = await postJson('/api/embeddings', {
        model: config.ai.embeddingModel,
        prompt: text
      });

      embeddings.push(response.embedding);
    }

    assertEmbeddingDimensions(embeddings);
    return embeddings;
  }

  const payload = {
    model: config.ai.embeddingModel,
    input: texts
  };

  const response = await postJson('/embeddings', payload);
  const embeddings = (response.data || [])
    .sort((left, right) => left.index - right.index)
    .map((item) => item.embedding);

  assertEmbeddingDimensions(embeddings);
  return embeddings;
}

export async function embedQuery(text) {
  const embeddings = await embedTexts([text]);
  return embeddings[0];
}

export async function generateRagAnswer(question, contexts) {
  const trimmedContexts = [];
  let totalChars = 0;

  for (const context of contexts) {
    const section = `[Source: ${context.originalName} | chunk ${context.chunkIndex}]\n${context.text}`;

    if (totalChars + section.length > config.rag.maxContextChars) {
      break;
    }

    trimmedContexts.push(section);
    totalChars += section.length;
  }

  const messages = [
    {
      role: 'system',
      content:
        'You are a helpful RAG assistant. Answer only from the provided document context. If the answer is not present in the context, clearly say you do not know based on the uploaded documents.'
    },
    {
      role: 'user',
      content: `Question:\n${question}\n\nDocument context:\n${trimmedContexts.join('\n\n---\n\n')}\n\nGive a concise answer and mention relevant source filenames when useful.`
    }
  ];

  return generateChatCompletion(messages);
}

export async function generateTemplateRules(templateText) {
  const messages = [
    {
      role: 'system',
      content:
        'You extract missing-detail validation requirements from a template. Use only the template text. Do not use external knowledge. Return only valid JSON with no markdown, comments, or prose.'
    },
    {
      role: 'user',
      content: `Analyze this template and return requirements for checking whether submitted documents include the details required by this template.

Rules:
- Use only the template text below.
- Do not infer facts from the real world.
- Do not create grammar, spelling, syntax, punctuation, tone, style, capitalization, or wording-quality rules.
- Treat labels, placeholders, headings, blanks, named fields, and clearly required sections as required details.
- If the template includes example values, use them only to understand what kind of detail belongs in that place.
- Do not require exact wording unless the template explicitly says exact wording is required.

Return a JSON object with this exact shape:
{
  "summary": "short description of the template",
  "requiredSections": ["section names that must appear"],
  "requiredFields": ["fields, labels, values, or signatures that must appear"],
  "formatRules": [],
  "validationChecklist": ["missing-detail checks to run against submitted documents"]
}

Template:
${truncateText(templateText, config.rag.maxContextChars)}`
    }
  ];

  const responseText = await generateChatCompletion(messages, { temperature: 0 });
  const rules = extractJsonObject(responseText);

  return {
    summary: String(rules.summary || ''),
    requiredSections: Array.isArray(rules.requiredSections) ? rules.requiredSections : [],
    requiredFields: Array.isArray(rules.requiredFields) ? rules.requiredFields : [],
    formatRules: Array.isArray(rules.formatRules) ? rules.formatRules : [],
    validationChecklist: Array.isArray(rules.validationChecklist) ? rules.validationChecklist : []
  };
}

export async function generateTemplateValidation({ rules, templateText, documentText }) {
  const messages = [
    {
      role: 'system',
      content:
        'You are a missing-detail checker. Use only the provided template rules and submitted document text. Do not use external knowledge or check factual correctness, grammar, syntax, spelling, punctuation, tone, style, capitalization, or writing quality. Return only valid JSON with no markdown, comments, or prose.'
    },
    {
      role: 'user',
      content: `Validate the submitted document against the template only for missing required details. Do not validate grammar, syntax, spelling, tone, writing quality, punctuation, capitalization, title casing, or stylistic differences. Do not fail a document because wording differs from the template if the required detail is present.

Use only the original template text, template rules, and submitted document text below. The original template text is the source of truth. Do not use your training data, real-world facts, current events, public knowledge, or assumptions about what is "correct." For example, do not decide that a name, title, date, company, law, address, or country fact is wrong based on outside knowledge. Only decide whether a required detail from the template appears to be present or missing in the submitted document.

The template itself may contain typos, unusual capitalization, outdated names, or factually incorrect text. Treat those as accepted template content. Do not correct the template. If the document repeats the same template detail, it passes even if you believe the detail is misspelled or factually wrong.

Spelling mistakes, typos, grammar mistakes, syntax mistakes, title-case differences, and alternate wording must be treated as acceptable when the required detail is still recognizable. Do not list them as failed checks, warnings, section issues, format issues, missing fields, or recommendations.

Ignore all formatting rules unless the formatting rule represents a required missing detail, such as a missing date, missing signature, missing identifier, missing section, or missing field. Leave "formatIssues" empty for grammar, syntax, spelling, punctuation, layout, capitalization, or style concerns.

Explain your decision clearly. Every failed or warning item must include:
- what requirement was checked
- why the required detail is missing or may be missing
- a short evidence quote or "Not found" if the content is missing

Return a JSON object with this exact shape:
{
  "status": "pass | fail | warning",
  "score": 0,
  "summary": "plain-language explanation of the validation outcome",
  "passedChecks": [
    {
      "requirement": "requirement that passed",
      "evidence": "short supporting quote or observation"
    }
  ],
  "failedChecks": [
    {
      "requirement": "requirement that failed",
      "reason": "why it failed",
      "evidence": "short quote or Not found"
    }
  ],
  "warnings": [
    {
      "requirement": "requirement that may need review",
      "reason": "why it is uncertain or partial",
      "evidence": "short quote or observation"
    }
  ],
  "missingFields": [
    {
      "field": "missing field name",
      "reason": "why this field is required"
    }
  ],
  "sectionIssues": [
    {
      "section": "section name",
      "reason": "what is wrong or missing",
      "evidence": "short quote or Not found"
    }
  ],
  "formatIssues": [
    {
      "rule": "missing-detail rule only",
      "reason": "what required detail is missing",
      "evidence": "Not found"
    }
  ],
  "recommendations": ["specific next action"]
}

Use this scoring guide:
- 90-100: all required details are present
- 70-89: mostly complete with small missing details
- 40-69: important requirements are missing or unclear
- 0-39: many required requirements are missing
- 0 only when the document is unreadable, unrelated to the template, or contains none of the required details

Template rules:
${JSON.stringify(rules, null, 2)}

Original template text:
${truncateText(templateText, Math.floor(config.rag.maxContextChars / 2))}

Submitted document:
${truncateText(documentText, Math.floor(config.rag.maxContextChars / 2))}`
    }
  ];

  const responseText = await generateChatCompletion(messages, { temperature: 0 });
  const validation = extractJsonObject(responseText);
  const normalizedStatus = String(validation.status || 'warning').toLowerCase();
  const status = ['pass', 'fail', 'warning'].includes(normalizedStatus)
    ? normalizedStatus
    : 'warning';
  const score = Math.max(0, Math.min(Number(validation.score) || 0, 100));

  const failedChecks = removeDisallowedValidationItems(validation.failedChecks);
  const warnings = removeDisallowedValidationItems(validation.warnings);
  const missingFields = removeDisallowedValidationItems(validation.missingFields);
  const sectionIssues = removeDisallowedValidationItems(validation.sectionIssues);
  const formatIssues = [];
  const hasIssues =
    failedChecks.length > 0 ||
    warnings.length > 0 ||
    missingFields.length > 0 ||
    sectionIssues.length > 0;

  return {
    status: hasIssues ? status : 'pass',
    score: hasIssues ? score : 100,
    summary: hasIssues
      ? String(validation.summary || '')
      : 'No required template details were reported missing.',
    passedChecks: normalizeArray(validation.passedChecks),
    failedChecks,
    warnings,
    missingFields,
    sectionIssues,
    formatIssues,
    recommendations: hasIssues
      ? removeDisallowedValidationItems(validation.recommendations)
      : []
  };
}
