// utils/initLocalAuth.js
require('dotenv').config();
const postgres = require('postgres');

const sql = postgres({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function mockAuth() {
  console.log('🔌 Connecting to local DB...');
  try {
    // 1. Create the 'auth' schema
    await sql`CREATE SCHEMA IF NOT EXISTS auth`;
    console.log('✅ Schema "auth" created.');

    // 2. Create the mock 'users' table
    await sql`
      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY,
        email TEXT
      )
    `;
    console.log('✅ Table "auth.users" created.');
    
  } catch (err) {
    console.error('❌ Error mocking auth:', err);
  } finally {
    await sql.end();
  }
}

mockAuth();