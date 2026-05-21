'use strict';

/**
 * ytvideo controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { normalizeYtVideoFields } = require('../utils/youtube');

const DEFAULT_HOMEPAGE_VIDEO_SORT = ['sortOrder:asc', 'publishedAt:desc'];

const applyHomepageVideoDefaults = (query = {}) => {
  return {
    ...query,
    sort: query.sort || DEFAULT_HOMEPAGE_VIDEO_SORT,
  };
};

module.exports = createCoreController('api::ytvideo.ytvideo', () => ({
  async find(ctx) {
    ctx.query = applyHomepageVideoDefaults(ctx.query);

    const response = await super.find(ctx);

    if (Array.isArray(response.data)) {
      response.data = response.data.map((entry) => normalizeYtVideoFields(entry));
    }

    return response;
  },

  async findOne(ctx) {
    const response = await super.findOne(ctx);

    if (response.data) {
      response.data = normalizeYtVideoFields(response.data);
    }

    return response;
  },
}));
