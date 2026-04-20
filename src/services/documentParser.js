import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

const supportedExtensions = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.json']);

export function isSupportedFile(fileName = '', mimeType = '') {
  const extension = path.extname(fileName).toLowerCase();

  if (supportedExtensions.has(extension)) {
    return true;
  }

  return mimeType.startsWith('text/');
}

export async function extractTextFromFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const buffer = await fs.readFile(filePath);

  if (extension === '.pdf') {
    const pdfResult = await pdfParse(buffer);
    return pdfResult.text || '';
  }

  if (extension === '.docx') {
    const docxResult = await mammoth.extractRawText({ buffer });
    return docxResult.value || '';
  }

  return buffer.toString('utf8');
}
