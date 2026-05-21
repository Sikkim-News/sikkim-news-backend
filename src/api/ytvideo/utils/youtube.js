'use strict';

const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

const extractYouTubeVideoId = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  if (YOUTUBE_ID_PATTERN.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    const hostname = parsedUrl.hostname.replace(/^www\./, '').toLowerCase();

    if (hostname === 'youtu.be') {
      const shortId = parsedUrl.pathname.split('/').filter(Boolean)[0];
      return YOUTUBE_ID_PATTERN.test(shortId) ? shortId : null;
    }

    if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
      const watchId = parsedUrl.searchParams.get('v');
      if (YOUTUBE_ID_PATTERN.test(watchId)) {
        return watchId;
      }

      const pathSegments = parsedUrl.pathname.split('/').filter(Boolean);
      const embeddedId = pathSegments.find((segment, index) => {
        const previousSegment = pathSegments[index - 1];
        return ['embed', 'shorts', 'live', 'v'].includes(previousSegment) && YOUTUBE_ID_PATTERN.test(segment);
      });

      if (embeddedId) {
        return embeddedId;
      }
    }
  } catch (error) {
    const fallbackMatch = trimmedValue.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[?&/#]|$)/);
    if (fallbackMatch) {
      return fallbackMatch[1];
    }
  }

  return null;
};

const buildYouTubeThumbnailUrl = (videoId) => {
  if (!videoId || !YOUTUBE_ID_PATTERN.test(videoId)) {
    return null;
  }

  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
};

const normalizeYtVideoFields = (input = {}) => {
  const youtubeUrl = input.youtubeUrl || input.Link || null;
  const derivedVideoId = extractYouTubeVideoId(input.youtubeVideoId) || extractYouTubeVideoId(youtubeUrl);
  const thumbnailUrl = input.thumbnailUrl || buildYouTubeThumbnailUrl(derivedVideoId);

  return {
    ...input,
    youtubeUrl,
    youtubeVideoId: derivedVideoId,
    thumbnailUrl,
  };
};

module.exports = {
  buildYouTubeThumbnailUrl,
  extractYouTubeVideoId,
  normalizeYtVideoFields,
};
