/**
 * Which files of the production repository may reach the code index.
 *
 * Deny by default: a path is indexed only if it matches an allowed root and no
 * exclusion. Anything indexed is sent to Voyage (embeddings) and to Claude
 * (bot context), so config, security code and non-source folders stay out.
 *
 * Which repository that is, and its Java package, are settings (`functions/.env`,
 * see `.env.example`): this repo is public and doesn't name them.
 */

type Env = Record<string, string | undefined>;

export interface CodeRepo {
  owner: string;
  repo: string;
  branch: string;
}

/** `CODE_REPO=owner/repo@branch`. */
export function codeRepo(env: Env = process.env): CodeRepo {
  const match = /^([\w.-]+)\/([\w.-]+)@([\w./-]+)$/.exec(env.CODE_REPO?.trim() ?? '');
  if (!match) throw new Error('CODE_REPO must be set as owner/repo@branch');
  return { owner: match[1], repo: match[2], branch: match[3] };
}

/** `CODE_JAVA_PACKAGE=com/example/app` (dots work too), as a path under `src/main/java`. Null when it isn't set. */
export function javaPackage(env: Env = process.env): string | null {
  const value = env.CODE_JAVA_PACKAGE?.trim().replace(/\./g, '/') ?? '';
  return /^[a-z_]\w*(\/[a-z_]\w*)*$/i.test(value) ? value : null;
}

/**
 * Not knowing the package must stop a sync, not shrink it: files that stop being listed
 * look deleted, and their chunks would go with them.
 */
function javaRoot(env: Env): string {
  const pkg = javaPackage(env);
  if (!pkg) throw new Error('CODE_JAVA_PACKAGE must be set, like com/example/app');
  return `src/main/java/${pkg}`;
}

const JAVA_LAYERS = ['domain', 'service', 'web'] as const;
const WEB_ROOTS = ['src/main/webapp/app', 'src/main/webapp/i18n/es'] as const;

/** Directories walked in the repository tree; see `isIndexablePath` for the per-file rule. */
export function indexRoots(env: Env = process.env): string[] {
  const java = javaRoot(env);
  return [...JAVA_LAYERS.map((layer) => `${java}/${layer}`), ...WEB_ROOTS];
}

const ALLOWED_WEB: RegExp[] = [/^src\/main\/webapp\/app\/.+\.(js|html)$/, /^src\/main\/webapp\/i18n\/es\/.+\.json$/];

function isAllowedJava(path: string, java: string): boolean {
  if (!path.startsWith(`${java}/`) || !path.endsWith('.java')) return false;
  const inside = path.slice(java.length + 1);
  return JAVA_LAYERS.some((layer) => inside.startsWith(`${layer}/`) && inside.length > layer.length + '/.java'.length);
}

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

export function isIndexablePath(path: string, env: Env = process.env): boolean {
  const allowed = ALLOWED_WEB.some((re) => re.test(path)) || isAllowedJava(path, javaRoot(env));
  return allowed && !EXCLUDED.some((re) => re.test(path));
}
