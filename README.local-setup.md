# Local backend setup (no local Postgres required)

## 1. Use SQLite locally

Create a `.env` in the project root:

```env
HOST=0.0.0.0
PORT=1337
APP_KEYS="devKey1,devKey2,devKey3,devKey4"
API_TOKEN_SALT=devApiSalt
ADMIN_JWT_SECRET=devAdminJwtSecret
TRANSFER_TOKEN_SALT=devTransferSalt
JWT_SECRET=devJwtSecret
DATABASE_CLIENT=sqlite
DATABASE_FILENAME=data.db
```

This forces Strapi to use SQLite instead of Postgres for local development.

## 2. Start Strapi

```bash
npm install
npm run develop
```

If this is a first run, `src/bootstrap.js` seeds starter data from `data/data.json`.

## 3. Sync content from production to local

A helper script is included at `scripts/sync-from-prod.js`.

### Inputs needed
- `PROD_STRAPI_URL` (example: `https://cms.example.com`)
- Optional `PROD_STRAPI_TOKEN` if prod read endpoints are protected
- `LOCAL_STRAPI_TOKEN` with write access on local Strapi

### Dry run (recommended first)

```bash
PROD_STRAPI_URL="https://your-prod-cms" \
LOCAL_STRAPI_TOKEN="your-local-token" \
npm run sync:prod -- --dry-run
```

### Real sync (content only)

```bash
PROD_STRAPI_URL="https://your-prod-cms" \
LOCAL_STRAPI_TOKEN="your-local-token" \
npm run sync:prod
```

### Real sync + media copy

```bash
PROD_STRAPI_URL="https://your-prod-cms" \
LOCAL_STRAPI_TOKEN="your-local-token" \
npm run sync:prod -- --media copy
```

### With explicit tokens/URLs

```bash
npm run sync:prod -- \
  --prod-url "https://your-prod-cms" \
  --prod-token "prod-read-token-if-needed" \
  --local-url "http://localhost:1337" \
  --local-token "local-write-token" \
  --media copy
```

## What the sync script handles
- Upserts `categories` by `slug`
- Upserts `writers` by `email`
- Upserts `articles` by `slug`
- Updates single types: `global`, `homepage`
- Optional media transfer via `/api/upload` (`--media copy`)

## Notes
- Script assumes Strapi v4 REST response format.
- Run against a local backup DB if you want a reversible test pass.
