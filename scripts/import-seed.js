#!/usr/bin/env node
'use strict';

process.env.SKIP_BOOTSTRAP_SEED = 'true';

const { compileStrapi, createStrapi } = require('@strapi/strapi');
const bootstrap = require('../src/bootstrap');

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();

  global.strapi = app;

  try {
    await bootstrap.runSeedImport();
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('Seed import failed.');
  console.error(error);
  process.exit(1);
});
