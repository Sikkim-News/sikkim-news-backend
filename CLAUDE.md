# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run develop        # Start Strapi with hot-reload (development)
npm run start          # Start Strapi without hot-reload (production)
npm run build          # Build the admin panel

npm run seed:import    # Re-run seed data import (skips bootstrap auto-check)
npm run sync:prod      # Sync content from production DigitalOcean backend to local
npm run sync:sikkim    # Same as sync:prod but with the prod URL pre-set
```

### Sync script flags
```bash
# Dry-run (no writes)
npm run sync:prod -- --dry-run

# Include media copy
npm run sync:prod -- --media copy

# Pass credentials explicitly
npm run sync:prod -- \
  --prod-url "https://your-prod-cms" \
  --prod-token "prod-read-token" \
  --local-token "local-write-token"
```

## Local development setup

Strapi defaults to SQLite locally. Create `.env` with these keys:

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

Production uses PostgreSQL (`DATABASE_CLIENT=postgres`, `DATABASE_URL=...`). Cloudinary upload is opt-in: it activates only when `CLOUDINARY_NAME`, `CLOUDINARY_KEY`, and `CLOUDINARY_SECRET` are all set; otherwise Strapi uses local storage.

## Architecture

This is a **Strapi v4** headless CMS backend. All content types live under `src/api/` following Strapi's standard layout (`content-types/`, `controllers/`, `routes/`, `services/`).

### Content types

| API name | Kind | Key field |
|----------|------|-----------|
| `article` | Collection | `slug` (uid, auto-generated from title) |
| `category` | Collection | `slug` |
| `writer` | Collection | `email` |
| `ytvideo` | Collection | `youtubeUrl` / `youtubeVideoId` |
| `global` | Single type | — |
| `homepage` | Single type | — |

`article` uses a `coverImage` component (`shared.image`) and a repeatable `otherImages` component. The `lifecycles.js` for article is intentionally commented out — it was left from v4 and must be rewritten as a document-service middleware before re-enabling (see comment in that file).

### YtVideo normalization

When a `ytvideo` is created or updated, `src/bootstrap.js` registers a document-service middleware that calls `normalizeYtVideoFields` (`src/api/ytvideo/utils/youtube.js`). This extracts a clean `youtubeVideoId` from any YouTube URL format and derives `thumbnailUrl` automatically.

### Bootstrap & seeding

On first run (`initHasRun` store flag not set), `src/bootstrap.js` seeds from `data/data.json` and uploads images from `data/uploads/`. Set `SKIP_BOOTSTRAP_SEED=true` to suppress this. To re-seed without restarting Strapi, use `npm run seed:import` which boots Strapi headlessly and calls `runSeedImport()` directly.

### Prod-to-local sync (`scripts/sync-from-prod.js`)

Fetches all collection types and single types from a remote Strapi instance and upserts them locally using stable natural keys (slug, email). Categories and writers are synced first so their IDs are available when resolving article relations. The `--media copy` flag downloads media from production and re-uploads it to local storage.

The default production URL is `https://sikkim-news-backend-p6i7o.ondigitalocean.app` (DigitalOcean App Platform).

### Public permissions

Bootstrap sets public read access for: `global`, `homepage`, `article`, `category`, `writer`, and `ytvideo`. These permissions are set once during the first-run seed via `plugin::users-permissions.permission`.
