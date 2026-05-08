import dotenv from 'dotenv';

dotenv.config();

function printUsage() {
  console.log(`
Usage:
  node scripts/delete-vector-store-files.js --vector-store-id <id> <file-id> [file-id...]

Example:
  node scripts/delete-vector-store-files.js \\
    --vector-store-id vs_iad_example \\
    file-iad-example-1 file-iad-example-2

Environment:
  OCI_GENERATIVE_AI_BASE_URL or OCI_REGION
  OCI_GENERATIVE_AI_API_KEY
  OCI_GENERATIVE_AI_PROJECT_ID
`);
}

function parseArgs(argv) {
  const args = [...argv];
  let vectorStoreId = '';
  const fileIds = [];

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === '--help' || arg === '-h') {
      return { help: true, vectorStoreId, fileIds };
    }

    if (arg === '--vector-store-id' || arg === '--vectorStoreId') {
      vectorStoreId = String(args.shift() || '').trim();
      continue;
    }

    if (arg?.startsWith('--vector-store-id=')) {
      vectorStoreId = arg.slice('--vector-store-id='.length).trim();
      continue;
    }

    if (arg) {
      fileIds.push(arg.trim());
    }
  }

  return {
    help: false,
    vectorStoreId,
    fileIds: fileIds.filter(Boolean)
  };
}

function getBaseUrl() {
  const configuredBaseUrl = String(
    process.env.OCI_GENERATIVE_AI_BASE_URL || process.env.OCI_OPENAI_BASE_URL || ''
  ).trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/$/, '');
  }

  const region = String(process.env.OCI_REGION || '').trim();

  if (!region) {
    throw new Error('Set OCI_GENERATIVE_AI_BASE_URL or OCI_REGION.');
  }

  return `https://inference.generativeai.${region}.oci.oraclecloud.com/openai/v1`;
}

function getHeaders() {
  const apiKey = process.env.OCI_GENERATIVE_AI_API_KEY || '';
  const projectId = String(process.env.OCI_GENERATIVE_AI_PROJECT_ID || '').trim();

  if (!apiKey) {
    throw new Error('Set OCI_GENERATIVE_AI_API_KEY.');
  }

  if (!projectId) {
    throw new Error('Set OCI_GENERATIVE_AI_PROJECT_ID.');
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'OpenAi-Project': projectId
  };
}

async function parseResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

async function deleteVectorStoreFile(baseUrl, headers, vectorStoreId, fileId) {
  const path = `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers
  });
  const payload = await parseResponse(response);

  return {
    fileId,
    ok: response.ok,
    status: response.status,
    payload
  };
}

async function main() {
  const { help, vectorStoreId, fileIds } = parseArgs(process.argv.slice(2));

  if (help) {
    printUsage();
    return;
  }

  if (!vectorStoreId || fileIds.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const baseUrl = getBaseUrl();
  const headers = getHeaders();
  let failedCount = 0;

  for (const fileId of fileIds) {
    const result = await deleteVectorStoreFile(baseUrl, headers, vectorStoreId, fileId);

    if (result.ok) {
      console.log(`Deleted ${fileId} from vector store ${vectorStoreId}.`);
      continue;
    }

    failedCount += 1;
    const details = result.payload?.error?.message ||
      result.payload?.message ||
      result.payload?.raw ||
      JSON.stringify(result.payload);
    console.error(`Failed to delete ${fileId}: HTTP ${result.status} ${details}`);
  }

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
