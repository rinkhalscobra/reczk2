const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const PUBLIC_SITE_URL = withoutTrailingSlash(
  import.meta.env.VITE_PUBLIC_SITE_URL || 'http://localhost:8080',
);
