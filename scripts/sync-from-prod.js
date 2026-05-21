#!/usr/bin/env node
'use strict';

require('dotenv').config();
const path = require('path');
const DEFAULT_REMOTE_URL = 'https://sikkim-news-backend-p6i7o.ondigitalocean.app';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    i += 1;
  }
  return out;
}

function normalizeBaseUrl(url) {
  return (url || '').replace(/\/$/, '');
}

function joinUrl(base, route) {
  return `${normalizeBaseUrl(base)}${route.startsWith('/') ? '' : '/'}${route}`;
}

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestJson({ url, method = 'GET', token, body }) {
  const headers = {
    ...authHeaders(token),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (e) {
    parsed = text;
  }

  if (!res.ok) {
    const details = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    throw new Error(`${method} ${url} failed (${res.status}): ${details}`);
  }

  return parsed;
}

async function requestJsonAllow404(params) {
  try {
    return await requestJson(params);
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('failed (404)')) return null;
    throw err;
  }
}

async function fetchAllCollection({
  baseUrl,
  token,
  endpoint,
  populateQuery = 'populate=*',
  pageSize = 100,
  extraQuery = 'publicationState=preview',
}) {
  const items = [];
  let page = 1;

  while (true) {
    const qs = [
      `pagination[page]=${page}`,
      `pagination[pageSize]=${pageSize}`,
      populateQuery,
      extraQuery,
    ].filter(Boolean).join('&');
    const url = joinUrl(baseUrl, `/api/${endpoint}?${qs}`);
    const json = await requestJson({ url, token });

    const data = Array.isArray(json?.data) ? json.data : [];
    items.push(...data);

    const pageCount = json?.meta?.pagination?.pageCount || 1;
    if (page >= pageCount) break;
    page += 1;
  }

  return items;
}

async function fetchAllCollectionAllow404(params) {
  try {
    return await fetchAllCollection(params);
  } catch (err) {
    const msg = err?.message || '';
    if (msg.includes('failed (404)')) return [];
    throw err;
  }
}

async function fetchSingleType({ baseUrl, token, endpoint, populateQuery = 'populate=*' }) {
  const url = joinUrl(baseUrl, `/api/${endpoint}?${populateQuery}`);
  const json = await requestJsonAllow404({ url, token });
  if (!json) return null;
  return json?.data || null;
}

function mediaUrlFromAttributes(attrs, baseUrl) {
  if (!attrs?.url) return null;
  if (attrs.url.startsWith('http://') || attrs.url.startsWith('https://')) return attrs.url;
  return joinUrl(baseUrl, attrs.url);
}

// Normalizes Strapi v4 ({ attributes: {} }) and v5 (flat) response shapes
function getAttrs(item) {
  return item?.attributes ?? item ?? {};
}

function getRelationData(node) {
  if (!node) return null;
  return node.data ?? node;
}

function ensureArray(node) {
  if (!node) return [];
  return Array.isArray(node) ? node : [];
}

function relationItems(node) {
  if (!node) return [];
  if (Array.isArray(node?.data)) return node.data;
  if (node?.data) return [node.data];
  if (Array.isArray(node)) return node;
  return [node];
}

function fileNameFromUrl(url, fallback = 'file') {
  try {
    const u = new URL(url);
    const name = path.basename(u.pathname);
    return name || fallback;
  } catch (e) {
    return fallback;
  }
}

async function uploadMediaFromUrl({ sourceUrl, localBaseUrl, localToken, cache }) {
  if (!sourceUrl) return null;

  if (cache.has(sourceUrl)) {
    return cache.get(sourceUrl);
  }

  const sourceRes = await fetch(sourceUrl);
  if (!sourceRes.ok) {
    throw new Error(`Failed to fetch media from ${sourceUrl} (${sourceRes.status})`);
  }

  const contentType = sourceRes.headers.get('content-type') || 'application/octet-stream';
  const buffer = await sourceRes.arrayBuffer();
  const fileName = fileNameFromUrl(sourceUrl);
  const blob = new Blob([buffer], { type: contentType });

  const form = new FormData();
  form.append('files', blob, fileName);

  const uploadRes = await fetch(joinUrl(localBaseUrl, '/api/upload'), {
    method: 'POST',
    headers: {
      ...authHeaders(localToken),
    },
    body: form,
  });

  const uploadJson = await uploadRes.json().catch(() => null);
  if (!uploadRes.ok) {
    throw new Error(`Upload failed for ${sourceUrl}: ${JSON.stringify(uploadJson, null, 2)}`);
  }

  const uploaded = Array.isArray(uploadJson) ? uploadJson[0] : null;
  const id = uploaded?.id || null;
  cache.set(sourceUrl, id);
  return id;
}

async function prepareMediaId({ mediaNode, mode, prodBaseUrl, localBaseUrl, localToken, uploadCache }) {
  const media = getRelationData(mediaNode);
  if (!media) return null;

  if (mode !== 'copy') return null;

  const attrs = media.attributes || {};
  const sourceUrl = mediaUrlFromAttributes(attrs, prodBaseUrl);
  if (!sourceUrl) return null;

  return uploadMediaFromUrl({
    sourceUrl,
    localBaseUrl,
    localToken,
    cache: uploadCache,
  });
}

async function upsertCollectionByKey({
  endpoint,
  keyName,
  getRemoteKey,
  getLocalKey,
  remoteItems,
  localItems,
  toLocalPayload,
  localBaseUrl,
  localToken,
  dryRun,
  counters,
}) {
  const localByKey = new Map();
  for (const item of localItems) {
    const attrs = getAttrs(item);
    const localKey = getLocalKey ? getLocalKey(item) : attrs[keyName];
    if (localKey) {
      localByKey.set(localKey, item);
    }
  }

  for (const remote of remoteItems) {
    const remoteAttrs = remote?.attributes || {};
    const keyValue = getRemoteKey ? getRemoteKey(remote) : remoteAttrs[keyName];
    if (!keyValue) continue;

    const payload = await toLocalPayload(remote);
    const existing = localByKey.get(keyValue);

    if (dryRun) {
      if (existing) counters.updated += 1;
      else counters.created += 1;
      continue;
    }

    if (existing) {
      // Strapi v5 uses documentId in the URL; v4 uses integer id
      const localId = existing.documentId || existing.id;
      await requestJson({
        url: joinUrl(localBaseUrl, `/api/${endpoint}/${localId}`),
        method: 'PUT',
        token: localToken,
        body: { data: payload },
      });
      counters.updated += 1;
    } else {
      const created = await requestJson({
        url: joinUrl(localBaseUrl, `/api/${endpoint}`),
        method: 'POST',
        token: localToken,
        body: { data: payload },
      });
      counters.created += 1;
      const createdData = created?.data;
      const createdKey = getLocalKey ? getLocalKey(createdData) : getAttrs(createdData)?.[keyName];
      if (createdKey) {
        localByKey.set(createdKey, createdData);
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const prodBaseUrl = normalizeBaseUrl(args['prod-url'] || process.env.PROD_STRAPI_URL || DEFAULT_REMOTE_URL);
  const localBaseUrl = normalizeBaseUrl(args['local-url'] || process.env.LOCAL_STRAPI_URL || 'http://localhost:1337');
  const prodToken = args['prod-token'] || process.env.PROD_STRAPI_TOKEN || '';
  const localToken = args['local-token'] || process.env.LOCAL_STRAPI_TOKEN || '';

  const dryRun = Boolean(args['dry-run']);
  const mediaMode = args.media === 'copy' ? 'copy' : 'skip';

  if (!prodBaseUrl) {
    throw new Error('Missing --prod-url (or PROD_STRAPI_URL).');
  }

  if (!dryRun && !localToken) {
    throw new Error('Missing local write auth token. Pass --local-token or LOCAL_STRAPI_TOKEN.');
  }

  console.log('Sync config:');
  console.log(`- prod: ${prodBaseUrl}`);
  console.log(`- local: ${localBaseUrl}`);
  console.log(`- dryRun: ${dryRun}`);
  console.log(`- media: ${mediaMode}`);

  const uploadCache = new Map();

  console.log('\nFetching source content...');
  const [
    remoteCategories,
    remoteWriters,
    remoteArticles,
    remoteYtVideos,
    remoteGlobal,
    remoteHomepage,
  ] = await Promise.all([
    fetchAllCollection({ baseUrl: prodBaseUrl, token: prodToken, endpoint: 'categories', populateQuery: 'populate=*' }),
    fetchAllCollection({ baseUrl: prodBaseUrl, token: prodToken, endpoint: 'writers', populateQuery: 'populate=*' }),
    fetchAllCollection({
      baseUrl: prodBaseUrl,
      token: prodToken,
      endpoint: 'articles',
      populateQuery: [
        'populate[categories]=true',
        'populate[author]=true',
        'populate[image]=true',
        'populate[coverImage][populate]=image',
        'populate[otherImages][populate]=image',
      ].join('&'),
    }),
    fetchAllCollectionAllow404({ baseUrl: prodBaseUrl, token: prodToken, endpoint: 'ytvideos', populateQuery: 'populate=*' }),
    fetchSingleType({ baseUrl: prodBaseUrl, token: prodToken, endpoint: 'global', populateQuery: 'populate=*' }),
    fetchSingleType({ baseUrl: prodBaseUrl, token: prodToken, endpoint: 'homepage', populateQuery: 'populate=*' }),
  ]);

  const [localCategories, localWriters, localArticles, localYtVideos] = await Promise.all([
    fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'categories', populateQuery: 'populate=*' }),
    fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'writers', populateQuery: 'populate=*' }),
    fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'articles', populateQuery: 'populate=*' }),
    fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'ytvideos', populateQuery: 'populate=*' }),
  ]);

  const categoryIdBySlug = new Map(localCategories.map((i) => [getAttrs(i).slug, i?.id]));
  const writerIdByEmail = new Map(localWriters.map((i) => [getAttrs(i).email, i?.id]));
  const writerIdByName = new Map(localWriters.map((i) => [getAttrs(i).name, i?.id]));

  const categoryCounters = { created: 0, updated: 0 };
  await upsertCollectionByKey({
    endpoint: 'categories',
    keyName: 'slug',
    remoteItems: remoteCategories,
    localItems: localCategories,
    localBaseUrl,
    localToken,
    dryRun,
    counters: categoryCounters,
    toLocalPayload: async (remote) => {
      const attrs = remote.attributes || {};
      return {
        name: attrs.name,
        slug: attrs.slug,
      };
    },
  });

  if (!dryRun) {
    const fresh = await fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'categories', populateQuery: 'populate=*' });
    categoryIdBySlug.clear();
    for (const item of fresh) categoryIdBySlug.set(getAttrs(item).slug, item?.id);
  }

  const writerCounters = { created: 0, updated: 0 };
  await upsertCollectionByKey({
    endpoint: 'writers',
    keyName: 'email',
    getRemoteKey: (item) => item?.attributes?.email || item?.attributes?.name,
    getLocalKey: (item) => getAttrs(item).email || getAttrs(item).name,
    remoteItems: remoteWriters,
    localItems: localWriters,
    localBaseUrl,
    localToken,
    dryRun,
    counters: writerCounters,
    toLocalPayload: async (remote) => {
      const attrs = remote.attributes || {};
      const pictureId = await prepareMediaId({
        mediaNode: attrs.picture,
        mode: mediaMode,
        prodBaseUrl,
        localBaseUrl,
        localToken,
        uploadCache,
      });

      return {
        name: attrs.name,
        email: attrs.email,
        ...(pictureId ? { picture: pictureId } : {}),
      };
    },
  });

  if (!dryRun) {
    const fresh = await fetchAllCollection({ baseUrl: localBaseUrl, token: localToken, endpoint: 'writers', populateQuery: 'populate=*' });
    writerIdByEmail.clear();
    writerIdByName.clear();
    for (const item of fresh) {
      const a = getAttrs(item);
      if (a.email) writerIdByEmail.set(a.email, item.id);
      if (a.name) writerIdByName.set(a.name, item.id);
    }
  }

  if (remoteGlobal) {
    const ga = remoteGlobal.attributes || {};
    const shareImageId = await prepareMediaId({
      mediaNode: ga?.defaultSeo?.shareImage,
      mode: mediaMode,
      prodBaseUrl,
      localBaseUrl,
      localToken,
      uploadCache,
    });
    const faviconId = await prepareMediaId({
      mediaNode: ga?.favicon,
      mode: mediaMode,
      prodBaseUrl,
      localBaseUrl,
      localToken,
      uploadCache,
    });

    const payload = {
      siteName: ga.siteName,
      defaultSeo: {
        metaTitle: ga?.defaultSeo?.metaTitle,
        metaDescription: ga?.defaultSeo?.metaDescription,
        ...(shareImageId ? { shareImage: shareImageId } : {}),
      },
      ...(faviconId ? { favicon: faviconId } : {}),
    };

    if (dryRun) {
      console.log('Would update single type: global');
    } else {
      await requestJson({
        url: joinUrl(localBaseUrl, '/api/global'),
        method: 'PUT',
        token: localToken,
        body: { data: payload },
      });
    }
  }

  if (remoteHomepage) {
    const ha = remoteHomepage.attributes || {};
    const shareImageId = await prepareMediaId({
      mediaNode: ha?.seo?.shareImage,
      mode: mediaMode,
      prodBaseUrl,
      localBaseUrl,
      localToken,
      uploadCache,
    });

    const payload = {
      hero: {
        title: ha?.hero?.title,
      },
      seo: {
        metaTitle: ha?.seo?.metaTitle,
        metaDescription: ha?.seo?.metaDescription,
        ...(shareImageId ? { shareImage: shareImageId } : {}),
      },
    };

    if (dryRun) {
      console.log('Would update single type: homepage');
    } else {
      await requestJson({
        url: joinUrl(localBaseUrl, '/api/homepage'),
        method: 'PUT',
        token: localToken,
        body: { data: payload },
      });
    }
  }

  const articleCounters = { created: 0, updated: 0 };
  await upsertCollectionByKey({
    endpoint: 'articles',
    keyName: 'slug',
    remoteItems: remoteArticles,
    localItems: localArticles,
    localBaseUrl,
    localToken,
    dryRun,
    counters: articleCounters,
    toLocalPayload: async (remote) => {
      const attrs = remote.attributes || {};
      const authorEmail = attrs?.author?.data?.attributes?.email;
      const authorName = attrs?.author?.data?.attributes?.name;
      const categorySlugs = [
        ...relationItems(attrs?.categories).map((c) => c?.attributes?.slug).filter(Boolean),
        ...relationItems(attrs?.category).map((c) => c?.attributes?.slug).filter(Boolean),
      ];

      const localCategoryIds = categorySlugs
        .map((slug) => categoryIdBySlug.get(slug))
        .filter(Boolean);

      const localAuthorId = (authorEmail && writerIdByEmail.get(authorEmail))
        || (authorName && writerIdByName.get(authorName))
        || null;

      const imageId = await prepareMediaId({
        mediaNode: attrs.image,
        mode: mediaMode,
        prodBaseUrl,
        localBaseUrl,
        localToken,
        uploadCache,
      });

      const coverImageMediaId = await prepareMediaId({
        mediaNode: attrs?.coverImage?.image,
        mode: mediaMode,
        prodBaseUrl,
        localBaseUrl,
        localToken,
        uploadCache,
      });

      const otherImagesSource = ensureArray(attrs?.otherImages);
      const otherImages = [];
      for (const imgComp of otherImagesSource) {
        const uploadedId = await prepareMediaId({
          mediaNode: imgComp?.image,
          mode: mediaMode,
          prodBaseUrl,
          localBaseUrl,
          localToken,
          uploadCache,
        });
        if (uploadedId) {
          otherImages.push({
            image: uploadedId,
            caption: imgComp?.caption || '',
          });
        }
      }

      const payload = {
        title: attrs.title,
        description: attrs.description,
        content: attrs.content,
        slug: attrs.slug,
        tags: attrs.tags || null,
        publishedAt: attrs.publishedAt || new Date().toISOString(),
        coverImage: {
          ...(coverImageMediaId ? { image: coverImageMediaId } : {}),
          caption: attrs?.coverImage?.caption || '',
        },
        ...(localAuthorId ? { author: localAuthorId } : {}),
        ...(localCategoryIds.length ? { categories: localCategoryIds } : {}),
      };

      if (mediaMode === 'copy' && imageId) {
        payload.image = imageId;
      }

      if (mediaMode === 'copy' && otherImages.length) {
        payload.otherImages = otherImages;
      }

      return payload;
    },
  });

  const ytVideoCounters = { created: 0, updated: 0 };
  await upsertCollectionByKey({
    endpoint: 'ytvideos',
    keyName: 'youtubeUrl',
    getRemoteKey: (item) => {
      const attrs = item?.attributes || {};
      return attrs.youtubeVideoId || attrs.youtubeUrl || attrs.Link || attrs.title;
    },
    getLocalKey: (item) => {
      const attrs = getAttrs(item);
      return attrs.youtubeVideoId || attrs.youtubeUrl || attrs.Link || attrs.title;
    },
    remoteItems: remoteYtVideos,
    localItems: localYtVideos,
    localBaseUrl,
    localToken,
    dryRun,
    counters: ytVideoCounters,
    toLocalPayload: async (remote) => {
      const attrs = remote.attributes || {};

      return {
        title: attrs.title,
        youtubeUrl: attrs.youtubeUrl || attrs.Link,
        youtubeVideoId: attrs.youtubeVideoId || null,
        thumbnailUrl: attrs.thumbnailUrl || null,
        isFeatured: Boolean(attrs.isFeatured),
        sortOrder: Number.isInteger(attrs.sortOrder) ? attrs.sortOrder : 0,
        Link: attrs.Link || attrs.youtubeUrl || null,
        publishedAt: attrs.publishedAt || null,
      };
    },
  });

  console.log('\nDone. Summary:');
  console.log(`- categories: created ${categoryCounters.created}, updated ${categoryCounters.updated}`);
  console.log(`- writers: created ${writerCounters.created}, updated ${writerCounters.updated}`);
  console.log(`- articles: created ${articleCounters.created}, updated ${articleCounters.updated}`);
  console.log(`- ytvideos: created ${ytVideoCounters.created}, updated ${ytVideoCounters.updated}`);
  console.log(`- single types: global + homepage ${dryRun ? 'previewed' : 'updated'}`);
}

main().catch((err) => {
  console.error('\nSync failed:');
  console.error(err.message || err);
  process.exit(1);
});
