import dotenv from 'dotenv';
import oracledb from 'oracledb';

dotenv.config();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const TABLES_IN_DELETE_ORDER = [
  'validation_result_chunks',
  'template_chunks',
  'document_chunks',
  'validation_results',
  'templates',
  'documents'
];

function printUsage() {
  console.log(`
Usage:
  node scripts/cleanup-app-data.js --confirm

This deletes all rows from DocWiser application tables while keeping table
schemas, indexes, constraints, and identity columns intact.

Environment:
  ORACLE_USER
  ORACLE_PASSWORD
  ORACLE_CONNECT_STRING
`);
}

function hasConfirmFlag(argv) {
  return argv.includes('--confirm');
}

function getOracleConfig() {
  const user = process.env.ORACLE_USER || '';
  const password = process.env.ORACLE_PASSWORD || '';
  const connectString = process.env.ORACLE_CONNECT_STRING || '';
  const missing = [];

  if (!user) missing.push('ORACLE_USER');
  if (!password) missing.push('ORACLE_PASSWORD');
  if (!connectString) missing.push('ORACLE_CONNECT_STRING');

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  return { user, password, connectString };
}

async function tableExists(connection, tableName) {
  const result = await connection.execute(
    `SELECT COUNT(*) AS table_count
       FROM user_tables
      WHERE table_name = UPPER(:table_name)`,
    { table_name: tableName }
  );

  return Number(result.rows[0]?.TABLE_COUNT || 0) > 0;
}

async function countRows(connection, tableName) {
  const result = await connection.execute(`SELECT COUNT(*) AS row_count FROM ${tableName}`);
  return Number(result.rows[0]?.ROW_COUNT || 0);
}

async function collectCounts(connection) {
  const counts = {};

  for (const tableName of TABLES_IN_DELETE_ORDER) {
    if (await tableExists(connection, tableName)) {
      counts[tableName] = await countRows(connection, tableName);
    }
  }

  return counts;
}

function printCounts(title, counts) {
  console.log(title);

  for (const tableName of TABLES_IN_DELETE_ORDER) {
    if (Object.hasOwn(counts, tableName)) {
      console.log(`  ${tableName}: ${counts[tableName]}`);
    }
  }
}

async function deleteRows(connection) {
  for (const tableName of TABLES_IN_DELETE_ORDER) {
    if (!(await tableExists(connection, tableName))) {
      console.log(`Skipping ${tableName}; table does not exist.`);
      continue;
    }

    const result = await connection.execute(`DELETE FROM ${tableName}`);
    console.log(`Deleted ${result.rowsAffected || 0} row(s) from ${tableName}.`);
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  if (!hasConfirmFlag(process.argv.slice(2))) {
    printUsage();
    console.error('Refusing to delete data without --confirm.');
    process.exitCode = 1;
    return;
  }

  const connection = await oracledb.getConnection(getOracleConfig());

  try {
    const beforeCounts = await collectCounts(connection);
    printCounts('Rows before cleanup:', beforeCounts);

    await deleteRows(connection);
    await connection.commit();

    const afterCounts = await collectCounts(connection);
    printCounts('Rows after cleanup:', afterCounts);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
