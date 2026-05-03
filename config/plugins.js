module.exports = ({ env }) => {
  const hasCloudinary =
    Boolean(env("CLOUDINARY_NAME")) &&
    Boolean(env("CLOUDINARY_KEY")) &&
    Boolean(env("CLOUDINARY_SECRET"));

  if (!hasCloudinary) {
    return {};
  }

  return {
    upload: {
      config: {
        provider: "cloudinary",
        providerOptions: {
          cloud_name: env("CLOUDINARY_NAME"),
          api_key: env("CLOUDINARY_KEY"),
          api_secret: env("CLOUDINARY_SECRET"),
        },
        actionOptions: {
          upload: {},
          delete: {},
        },
      },
    },
  };
};
