type TranslationTree = { readonly [key: string]: string | TranslationTree };
type TranslationCatalog = Readonly<Record<string, TranslationTree>>;

const lookup = (tree: TranslationTree | undefined, segments: string[]): string | undefined => {
  let value: string | TranslationTree | undefined = tree;
  for (const segment of segments) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
    value = value[segment];
  }
  return typeof value === 'string' && value.trim() ? value : undefined;
};

/** Prefer the selected language, then English. A missing message must never
 * expose an internal dotted key to the person using the application. */
export const translate = (catalog: TranslationCatalog, language: string, key: string): string => {
  const segments = key.split('.').filter(Boolean);
  const message = lookup(catalog[language], segments) ?? lookup(catalog.en, segments);
  if (message !== undefined) return message;

  const label = (segments.at(-1) || '')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return label ? label[0].toUpperCase() + label.slice(1) : 'Text unavailable';
};
