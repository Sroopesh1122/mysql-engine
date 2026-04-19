const mysql = require('mysql2/promise');

async function executeJob(jobData) {
  let connection;
  const dbName = `sandbox_${jobData.jobId}`;

  try {
    connection = await mysql.createConnection({
      host: process.env.MYSQL_HOST || 'localhost',
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      decimalNumbers: true,
      connectTimeout: 5000,
      multipleStatements: true
    });

    // ================================
    // 1. CREATE ISOLATED DATABASE
    // ================================
    await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await connection.query(`CREATE DATABASE \`${dbName}\``);
    await connection.query(`USE \`${dbName}\``);

    console.log(`[${jobData.jobId}] Using DB: ${dbName}`);

    // ================================
    // 2. RUN SETUP CODE
    // ================================
    if (jobData.setup_code?.trim()) {
      const statements = splitSqlStatements(jobData.setup_code);

      for (const stmt of statements) {
        const cleanStmt = stmt.trim();
        if (cleanStmt.length > 0) {
          try {
            await connection.query(cleanStmt);
          } catch (stmtErr) {
            throw new Error(`Setup failed: ${stmtErr.sqlMessage}`);
          }
        }
      }
    }

    // ================================
    // 3. EXECUTE USER QUERY
    // ================================
    const start = Date.now();

    const [rows] = await connection.query({
      sql: jobData.user_query,
      timeout: jobData.timeoutMs || 12000
    });

    const executionTimeMs = Date.now() - start;

    // ================================
    // 4. RESULT COMPARISON
    // ================================
    let status = 'Accepted';
    let message = 'Query executed successfully';

    if (jobData.expected_result) {
      if (!compareResults(rows, jobData.expected_result)) {
        status = 'Wrong Answer';
        message = 'Output does not match expected result';
      }
    }

    return {
      status,
      message,
      output: rows,
      executionTimeMs,
      error: null,
      dbName
    };

  } catch (err) {
    const isTimeout =
      err.message?.toLowerCase().includes('timeout') ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ER_QUERY_TIMEOUT';

    return {
      status: isTimeout ? 'Time Limit Exceeded' : 'Runtime Error',
      message: err.sqlMessage || err.message,
      output: null,
      error: err.sqlMessage || err.message,
      dbName
    };

  } finally {
    // ================================
    // 5. CLEANUP DATABASE (IMPORTANT)
    // ================================
    try {
      if (connection) {
        await connection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        console.log(`[${jobData.jobId}] Cleaned DB: ${dbName}`);
        await connection.end();
      }
    } catch (cleanupErr) {
      console.error(`Cleanup failed for ${dbName}:`, cleanupErr.message);
    }
  }
}

// ================================
// Helpers (unchanged)
// ================================
function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map(stmt => stmt.trim())
    .filter(stmt => stmt.length > 0 && !stmt.toUpperCase().startsWith('USE '));
}

function compareResults(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;

  const normalize = (arr) =>
    [...arr].sort((a, b) =>
      JSON.stringify(Object.entries(a).sort())
        .localeCompare(JSON.stringify(Object.entries(b).sort()))
    );

  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

module.exports = { executeJob };