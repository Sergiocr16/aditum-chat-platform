/**
 * Which files of the production repository may reach the code index.
 *
 * Deny by default: a path is indexed only if it matches an allowed root and no
 * exclusion. Anything indexed is sent to Voyage (embeddings) and to Claude
 * (bot context), so config, security code and non-source folders stay out.
 */

export const CODE_REPO = {
  owner: 'Sergiocr16',
  repo: 'aditum-jh',
  branch: 'production',
} as const;

/** Directories walked in the repository tree; see `isIndexablePath` for the per-file rule. */
export const INDEX_ROOTS = [
  'src/main/java/com/lighthouse/aditum/domain',
  'src/main/java/com/lighthouse/aditum/service',
  'src/main/java/com/lighthouse/aditum/web',
  'src/main/webapp/app',
  'src/main/webapp/i18n/es',
] as const;

const ALLOWED: RegExp[] = [
  /^src\/main\/java\/com\/lighthouse\/aditum\/(domain|service|web)\/.+\.java$/,
  /^src\/main\/webapp\/app\/.+\.(js|html)$/,
  /^src\/main\/webapp\/i18n\/es\/.+\.json$/,
];

const EXCLUDED: RegExp[] = [
  /(^|\/)(config|security|aop|test|tests|docs|tasks|memory|scripts|bower_components|node_modules|vendor)\//i,
  /(^|\/)\.env/i,
  /(^|\/)services\/customjs\//i,
  /\.min\.(js|css)$/i,
  /\.(spec|test)\.js$/i,
  /Test\.java$/,
  /(^|\/)service\/mapper\//,
];

/** Files above this size are generated or data, not code worth retrieving. */
export const MAX_FILE_BYTES = 256 * 1024;

export function isIndexablePath(path: string): boolean {
  return ALLOWED.some((re) => re.test(path)) && !EXCLUDED.some((re) => re.test(path));
}
