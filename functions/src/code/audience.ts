/**
 * Who may get answers built from each indexed file. The bot talks only to the roles
 * the host lets into the chat: condominium
 * administrators and accountants. A screen that only accountants can open must not
 * inform an answer to an administrator, so visibility follows the authorities the
 * host itself enforces. Deny by default: a file nobody in the chat can reach is not
 * indexed at all, and an unrecognized contact role gets no code.
 */

export type { CodeAudience } from '@aditum-chat/shared';
import type { CodeAudience } from '@aditum-chat/shared';

const BOTH: readonly CodeAudience[] = ['manager', 'accountant'];

/** Resident-facing content isn't sensitive for staff, who support those residents. */
const RESIDENT_ROLES = ['ROLE_USER', 'ROLE_OWNER', 'ROLE_TENANT', 'ROLE_RENTER', 'ROLE_RESIDENT'];
const MANAGER_ROLES = ['ROLE_MANAGER', 'ROLE_ADMIN_MANAGER'];
const ACCOUNTANT_ROLES = ['ROLE_ACCOUNTANT'];

const ROLE_FROM_CONTACT: Record<string, CodeAudience> = {
  administrador: 'manager',
  contador: 'accountant',
};

/** The host sends a fixed label in `claims.role`. Anything else gets no code. */
export function audienceForContactRole(role: string | undefined): CodeAudience | null {
  return ROLE_FROM_CONTACT[role?.trim().toLowerCase() ?? ''] ?? null;
}

function audiencesFromRoles(roles: string[]): CodeAudience[] {
  const out: CodeAudience[] = [];
  const has = (candidates: string[]) => roles.some((role) => candidates.includes(role));
  if (has(RESIDENT_ROLES) || has(MANAGER_ROLES)) out.push('manager');
  if (has(RESIDENT_ROLES) || has(ACCOUNTANT_ROLES)) out.push('accountant');
  return out;
}

const union = (lists: CodeAudience[][]) => BOTH.filter((aud) => lists.some((list) => list.includes(aud)));
const intersection = (lists: CodeAudience[][]) => BOTH.filter((aud) => lists.every((list) => list.includes(aud)));

export interface AudienceMap {
  /** Templates a state names, keyed by repository path. */
  byTemplate: Map<string, CodeAudience[][]>;
  /** i18n parts a state loads, keyed by part name. */
  byPart: Map<string, CodeAudience[][]>;
  /** Every state declaring authorities, keyed by the directory of its state file. */
  byDirectory: Map<string, CodeAudience[][]>;
  /** Audience of each state file itself. */
  byStateFile: Map<string, CodeAudience[][]>;
}

const WEBAPP = 'src/main/webapp/';
const I18N = `${WEBAPP}i18n/es/`;

const dirname = (path: string) => path.slice(0, path.lastIndexOf('/'));

function push<K>(map: Map<K, CodeAudience[][]>, key: K, value: CodeAudience[]): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

export const isStateFile = (path: string) => path.endsWith('.state.js');

/** Reads the `.state(...)` blocks of the Angular router, the host's own access map for its UI. */
export function buildAudienceMap(stateFiles: { path: string; text: string }[]): AudienceMap {
  const map: AudienceMap = {
    byTemplate: new Map(),
    byPart: new Map(),
    byDirectory: new Map(),
    byStateFile: new Map(),
  };
  for (const { path, text } of stateFiles) {
    for (const block of text.split(/\.state\(\s*['"]/).slice(1)) {
      const declared = /authorities\s*:\s*\[([^\]]*)\]/.exec(block);
      // Abstract and layout states declare nothing, so they say nothing about access.
      if (!declared) continue;
      const roles = declared[1].match(/ROLE_\w+/g) ?? [];
      // An empty list is how the router marks a public page (login, password reset).
      const audience = roles.length === 0 ? [...BOTH] : audiencesFromRoles(roles);

      push(map.byDirectory, dirname(path), audience);
      push(map.byStateFile, path, audience);
      for (const match of block.matchAll(/templateUrl\s*:\s*['"]([^'"]+\.html)['"]/g)) {
        push(map.byTemplate, `${WEBAPP}${match[1]}`, audience);
      }
      for (const match of block.matchAll(/addPart\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        push(map.byPart, match[1], audience);
      }
    }
  }
  return map;
}

/**
 * A file no state names (a dialog, a service) takes what every state of its directory
 * shares, so a mixed directory doesn't hand staff-only code to the wider audience.
 * States reachable by nobody in the chat don't narrow it, but a directory holding only
 * those stays hidden instead of inheriting from its parent.
 */
function directoryAudience(path: string, map: AudienceMap): CodeAudience[] {
  for (let dir = dirname(path); dir.length >= `${WEBAPP}app`.length; dir = dirname(dir)) {
    const states = map.byDirectory.get(dir);
    if (!states) continue;
    const reachable = states.filter((audience) => audience.length > 0);
    return reachable.length > 0 ? intersection(reachable) : [];
  }
  // Shared components and services have no state of their own.
  return [...BOTH];
}

function javaAudience(text: string): CodeAudience[] {
  const annotations = [...text.matchAll(/@Secured\(([^)]*)\)/g)];
  if (annotations.length === 0) return [...BOTH];
  const roles = annotations.flatMap((match) => [
    ...(match[1].match(/ROLE_\w+/g) ?? []),
    ...[...match[1].matchAll(/AuthoritiesConstants\.(\w+)/g)].map((constant) =>
      constant[1] === 'HOUSE_RESIDENT' ? 'ROLE_RESIDENT' : `ROLE_${constant[1]}`,
    ),
  ]);
  return audiencesFromRoles(roles);
}

/** `text` matters only for Java, where the access rule lives in the file itself. */
export function audiencesOf(path: string, text: string, map: AudienceMap): CodeAudience[] {
  if (path.endsWith('.java')) return javaAudience(text);
  if (path.startsWith(I18N)) {
    const part = path.slice(I18N.length).replace(/\.json$/, '');
    const states = map.byPart.get(part);
    // Parts loaded only by layout states (`navBar`, `global`) are shared chrome.
    return states ? union(states) : [...BOTH];
  }
  const own = map.byStateFile.get(path) ?? map.byTemplate.get(path);
  if (own) return union(own);
  // A controller or service goes with the template of the same name.
  const stem = path.replace(/\.[^/.]+\.js$/, '').replace(/\.js$/, '');
  const sibling = map.byTemplate.get(`${stem}.html`);
  return sibling ? union(sibling) : directoryAudience(path, map);
}

/** True when `audiencesOf` depends only on the path and the state files, not the file's text. */
export const audienceFollowsStates = (path: string) => !path.endsWith('.java');
