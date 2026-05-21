"use strict";

const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const set = require("lodash.set");
const { normalizeYtVideoFields } = require("./api/ytvideo/utils/youtube");
const {
  categories,
  homepage,
  writers,
  articles,
  global,
} = require("../data/data.json");

async function isFirstRun() {
  const pluginStore = strapi.store({
    environment: strapi.config.environment,
    type: "type",
    name: "setup",
  });
  const initHasRun = await pluginStore.get({ key: "initHasRun" });
  await pluginStore.set({ key: "initHasRun", value: true });
  return !initHasRun;
}

async function setPublicPermissions(newPermissions) {
  // Find the ID of the public role
  const publicRole = await strapi
    .db.query("plugin::users-permissions.role")
    .findOne({
      where: {
        type: "public",
      },
    });

  // Create the new permissions and link them to the public role
  const allPermissionsToCreate = [];
  Object.keys(newPermissions).map(controller => {
    const actions = newPermissions[controller];
    const permissionsToCreate = actions.map(action => {
      return strapi.db.query("plugin::users-permissions.permission").create({
        data: {
          action: `api::${controller}.${controller}.${action}`,
          role: publicRole.id,
        },
      });
    });
    allPermissionsToCreate.push(...permissionsToCreate);
  });
  await Promise.all(allPermissionsToCreate);
}

function getFileSizeInBytes(filePath) {
  const stats = fs.statSync(filePath);
  const fileSizeInBytes = stats["size"];
  return fileSizeInBytes;
}

function getFileData(fileName) {
  const filePath = path.resolve(__dirname, `../data/uploads/${fileName}`);

  // Parse the file metadata
  const size = getFileSizeInBytes(filePath);
  const ext = fileName.split(".").pop();
  const mimeType = mime.lookup(ext);

  return {
    filepath: filePath,
    path: filePath,
    name: fileName,
    originalFilename: fileName,
    size,
    type: mimeType,
    mimetype: mimeType,
  };
}

async function uploadFile(file) {
  const [fileName] = file.name.split(".");
  const uploadedFiles = await strapi.plugin("upload").service("upload").upload({
    files: file,
    data: {
      fileInfo: {
        alternativeText: fileName,
        caption: fileName,
        name: fileName,
      },
    },
  });

  return uploadedFiles[0];
}

async function createEntry({ model, entry, files, publish = false }) {
  const data = structuredClone(entry);

  if (files) {
    for (const [key, file] of Object.entries(files)) {
      const uploadedFile = await uploadFile(file);
      set(data, key, uploadedFile.id);
    }
  }

  return strapi.documents(`api::${model}.${model}`).create({
    data,
    status: publish ? "published" : "draft",
  });
}

async function createPublishedEntry(options) {
  return createEntry({ ...options, publish: true });
}

async function importCategories() {
  const categoriesBySlug = new Map();

  for (const category of categories) {
    const createdCategory = await createEntry({ model: "category", entry: category });
    categoriesBySlug.set(category.slug, createdCategory.id);
  }

  return categoriesBySlug;
}

async function importHomepage() {
  const files = {
    "seo.shareImage": getFileData("default-image.png"),
  };
  await createEntry({ model: "homepage", entry: homepage, files });
}

async function importWriters() {
  const writersByEmail = new Map();

  for (const writer of writers) {
    const files = {
      picture: getFileData(`${writer.email}.jpg`),
    };
    const createdWriter = await createEntry({
      model: "writer",
      entry: writer,
      files,
    });
    writersByEmail.set(writer.email, createdWriter.id);
  }

  return writersByEmail;
}

async function importArticles({ categoriesBySlug, writersByEmail }) {
  const categorySlugByLegacyId = new Map(categories.map((category, index) => [index + 1, category.slug]));
  const writerEmailByLegacyId = new Map(writers.map((writer, index) => [index + 1, writer.email]));

  for (const article of articles) {
    const uploadedImage = await uploadFile(getFileData(`${article.slug}.jpg`));
    const categorySlug = categorySlugByLegacyId.get(article.category?.id);
    const writerEmail = writerEmailByLegacyId.get(article.author?.id);

    const categoryId = categorySlug ? categoriesBySlug.get(categorySlug) : null;
    const authorId = writerEmail ? writersByEmail.get(writerEmail) : null;

    const articleData = {
      title: article.title,
      description: article.description,
      content: article.content,
      slug: article.slug,
      image: uploadedImage.id,
      author: authorId,
      categories: categoryId ? [categoryId] : [],
      coverImage: {
        image: uploadedImage.id,
        caption: article.title,
      },
      otherImages: [],
    };

    await createPublishedEntry({
      model: "article",
      entry: articleData,
    });
  }
}

async function importGlobal() {
  const files = {
    favicon: getFileData("favicon.png"),
    "defaultSeo.shareImage": getFileData("default-image.png"),
  };
  return createEntry({ model: "global", entry: global, files });
}

async function importSeedData() {
  // Allow read of application content types
  await setPublicPermissions({
    global: ["find"],
    homepage: ["find"],
    ytvideo: ["find", "findOne"],
    article: ["find", "findOne"],
    category: ["find", "findOne"],
    writer: ["find", "findOne"],
  });

  // Create all entries
  const categoriesBySlug = await importCategories();
  await importHomepage();
  const writersByEmail = await importWriters();
  await importArticles({ categoriesBySlug, writersByEmail });
  await importGlobal();
}

async function runSeedImport() {
  console.log("Importing seed data...");
  await importSeedData();
  console.log("Seed data import complete.");
}

function registerYtVideoDocumentMiddleware() {
  strapi.documents.use(async (ctx, next) => {
    if (ctx.contentType?.uid !== "api::ytvideo.ytvideo") {
      return next();
    }

    if (!["create", "update"].includes(ctx.action) || !ctx.params?.data) {
      return next();
    }

    ctx.params.data = normalizeYtVideoFields(ctx.params.data);

    return next();
  });
}

async function bootstrap() {
  registerYtVideoDocumentMiddleware();

  if (process.env.SKIP_BOOTSTRAP_SEED === "true") {
    return;
  }

  const shouldImportSeedData = await isFirstRun();

  if (shouldImportSeedData) {
    try {
      console.log("Setting up the template...");
      await importSeedData();
      console.log("Ready to go");
    } catch (error) {
      console.log("Could not import seed data");
      console.error(error);
    }
  }
}

module.exports = bootstrap;
module.exports.runSeedImport = runSeedImport;
