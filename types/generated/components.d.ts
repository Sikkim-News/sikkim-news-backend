import type { Attribute, Schema } from '@strapi/strapi';

export interface SectionsHero extends Schema.Component {
  collectionName: 'components_decoration_heroes';
  info: {
    icon: 'address-card';
    name: 'Hero';
  };
  attributes: {
    title: Attribute.String & Attribute.Required;
  };
}

export interface SharedImage extends Schema.Component {
  collectionName: 'components_shared_images';
  info: {
    displayName: 'Image';
  };
  attributes: {
    caption: Attribute.String;
    image: Attribute.Media<'images' | 'files' | 'videos' | 'audios'>;
  };
}

export interface SharedSeo extends Schema.Component {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Attribute.Text & Attribute.Required;
    metaTitle: Attribute.String & Attribute.Required;
    shareImage: Attribute.Media<'images'>;
  };
}

export interface SharedTags extends Schema.Component {
  collectionName: 'components_shared_tags';
  info: {
    displayName: 'Tags';
  };
  attributes: {
    tags: Attribute.String;
  };
}

declare module '@strapi/types' {
  export module Shared {
    export interface Components {
      'sections.hero': SectionsHero;
      'shared.image': SharedImage;
      'shared.seo': SharedSeo;
      'shared.tags': SharedTags;
    }
  }
}
