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

  if (config.ai.provider === 'ollama') {
    const response = await postJson('/api/chat', {
      model: config.ai.chatModel,
      messages,
      stream: false,
      options: {
        temperature: config.ai.temperature
      }
    });

    return response.message?.content?.trim() || 'No answer returned by the LLM.';
  }

  const response = await postJson('/chat/completions', {
    model: config.ai.chatModel,
    temperature: config.ai.temperature,
    messages
  });

  return response.choices?.[0]?.message?.content?.trim() || 'No answer returned by the LLM.';
}
