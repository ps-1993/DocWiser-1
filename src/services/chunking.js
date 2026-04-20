export function normalizeText(text) {
  return text
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\u0000/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function chunkText(text, options = {}) {
  const chunkSize = Number(options.chunkSize || 1200);
  const chunkOverlap = Number(options.chunkOverlap || 200);
  const normalized = normalizeText(text);

  if (!normalized) {
    return [];
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks = [];
  let start = 0;

  while (start < words.length) {
    let end = start;
    let currentLength = 0;

    while (end < words.length) {
      const nextWordLength = words[end].length + (end === start ? 0 : 1);
      if (currentLength + nextWordLength > chunkSize && end > start) {
        break;
      }

      currentLength += nextWordLength;
      end += 1;
    }

    if (end === start) {
      end += 1;
    }

    const chunkWords = words.slice(start, end);
    chunks.push({
      index: chunks.length,
      text: chunkWords.join(' ')
    });

    if (end >= words.length) {
      break;
    }

    let overlapChars = 0;
    let nextStart = end;

    while (nextStart > start) {
      const priorWordLength = words[nextStart - 1].length + 1;
      if (overlapChars + priorWordLength > chunkOverlap) {
        break;
      }

      overlapChars += priorWordLength;
      nextStart -= 1;
    }

    start = nextStart === start ? end : nextStart;
  }

  return chunks;
}
