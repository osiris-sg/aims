#!/usr/bin/env node

/**
 * Refresh Staging Database
 *
 * Creates a new Neon branch from the production database (main branch).
 * This gives staging an instant, up-to-date copy of prod data.
 *
 * Prerequisites:
 *   1. Set NEON_API_KEY in your environment (get from https://console.neon.tech/app/settings/api-keys)
 *   2. Set NEON_PROJECT_ID in your environment (find in Neon dashboard URL or project settings)
 *
 * Usage:
 *   NEON_API_KEY=xxx NEON_PROJECT_ID=yyy node scripts/refresh-staging-db.mjs
 *   # or
 *   npm run db:refresh-staging  (if env vars are set)
 */

const NEON_API_KEY = process.env.NEON_API_KEY;
const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID;
const STAGING_BRANCH_NAME = 'staging';

if (!NEON_API_KEY || !NEON_PROJECT_ID) {
  console.error('Missing required environment variables:');
  if (!NEON_API_KEY) console.error('  - NEON_API_KEY: Get from https://console.neon.tech/app/settings/api-keys');
  if (!NEON_PROJECT_ID) console.error('  - NEON_PROJECT_ID: Find in your Neon project settings');
  process.exit(1);
}

const API_BASE = 'https://console.neon.tech/api/v2';
const headers = {
  Authorization: `Bearer ${NEON_API_KEY}`,
  'Content-Type': 'application/json',
};

async function apiCall(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Neon API ${method} ${path} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  console.log('Refreshing staging database from production...\n');

  // 1. List existing branches to find (and delete) old staging branch
  console.log('1. Checking for existing staging branch...');
  const { branches } = await apiCall('GET', `/projects/${NEON_PROJECT_ID}/branches`);

  const mainBranch = branches.find((b) => b.name === 'main' || b.primary);
  if (!mainBranch) {
    throw new Error('Could not find main/primary branch');
  }
  console.log(`   Found main branch: ${mainBranch.name} (${mainBranch.id})`);

  const existingStagingBranch = branches.find((b) => b.name === STAGING_BRANCH_NAME);
  if (existingStagingBranch) {
    console.log(`   Found existing staging branch (${existingStagingBranch.id}), deleting...`);
    await apiCall('DELETE', `/projects/${NEON_PROJECT_ID}/branches/${existingStagingBranch.id}`);
    console.log('   Deleted old staging branch.');
  } else {
    console.log('   No existing staging branch found.');
  }

  // 2. Create new staging branch from main
  console.log('\n2. Creating new staging branch from production...');
  const { branch, endpoints } = await apiCall('POST', `/projects/${NEON_PROJECT_ID}/branches`, {
    branch: {
      name: STAGING_BRANCH_NAME,
      parent_id: mainBranch.id,
    },
    endpoints: [
      {
        type: 'read_write',
      },
    ],
  });

  console.log(`   Created branch: ${branch.name} (${branch.id})`);

  // 3. Get the connection details
  const endpoint = endpoints?.[0];
  if (!endpoint) {
    console.log('\n   Branch created but no endpoint returned. Check Neon dashboard for connection string.');
    return;
  }

  console.log(`   Endpoint: ${endpoint.host}`);

  // 4. Get connection URI
  console.log('\n3. Fetching connection string...');
  const { uri } = await apiCall(
    'GET',
    `/projects/${NEON_PROJECT_ID}/connection_uri?branch_id=${branch.id}&role_name=AIMS_DB_owner&database_name=AIMS_DB&pooled=true`,
  );

  console.log('\n========================================');
  console.log('Staging database ready!');
  console.log('========================================');
  console.log('\nConnection string (pooled):');
  console.log(`  ${uri}`);
  console.log('\nUpdate your .env.staging DATABASE_URL with this value.');
  console.log('\nTo push the current schema:');
  console.log('  npm run db:push:staging');
}

main().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
