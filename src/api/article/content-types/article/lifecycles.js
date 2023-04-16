const slugify = require("slugify");

module.exports = {
  beforeCreate(event) {
    const { data } = event.params;
    if (data.Title) {
      data.Slug = slugify(data.Title, { lower: true });
    }
  },
  beforeUpdate(event) {
    const { data } = event.params;
    if (data.Title) {
      data.Slug = slugify(data.Title, { lower: true });
    }
  },
};
