import { CODE_REPO, INDEX_ROOTS, isIndexablePath, MAX_FILE_BYTES } from './allowlist.js';

/** Read-only GitHub client for the code index. Needs only "Contents: read" on the repository. */

const API = `https://api.github.com/repos/${CODE_REPO.owner}/${CODE_REPO.repo}`;

export interface RepoFile {
  path: string;
  blobSha: string;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

async function gh(token: string, path: string, accept = 'application/vnd.github+json'): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aditum-chat-code-index',
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return res;
}

export async function fetchBranchHead(token: string): Promise<string> {
  const res = await gh(token, `/branches/${CODE_REPO.branch}`);
  const body = (await res.json()) as { commit: { sha: string } };
  return body.commit.sha;
}

async function readTree(token: string, sha: string, recursive: boolean): Promise<TreeEntry[]> {
  const res = await gh(token, `/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
  const body = (await res.json()) as { tree: TreeEntry[]; truncated: boolean };
  // A truncated listing would make present files look deleted, so it must not pass silently.
  if (body.truncated) throw new Error(`GitHub truncated the tree ${sha}`);
  return body.tree;
}

/** Follows `root` from the commit down, one directory at a time. Null if it no longer exists. */
async function resolveDirectory(token: string, commitSha: string, root: string): Promise<string | null> {
  let treeSha = commitSha;
  for (const segment of root.split('/')) {
    const entries = await readTree(token, treeSha, false);
    const next = entries.find((entry) => entry.type === 'tree' && entry.path === segment);
    if (!next) return null;
    treeSha = next.sha;
  }
  return treeSha;
}

/**
 * Lists the indexable files at a commit. Walks only the allowed roots: the whole
 * repository is large enough for GitHub to truncate a recursive listing.
 */
export async function listIndexableFiles(token: string, commitSha: string): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  for (const root of INDEX_ROOTS) {
    const treeSha = await resolveDirectory(token, commitSha, root);
    if (!treeSha) continue;
    for (const entry of await readTree(token, treeSha, true)) {
      const path = `${root}/${entry.path}`;
      if (entry.type !== 'blob' || !isIndexablePath(path)) continue;
      if ((entry.size ?? 0) > MAX_FILE_BYTES) continue;
      files.push({ path, blobSha: entry.sha });
    }
  }
  return files;
}

export async function fetchBlobText(token: string, blobSha: string): Promise<string> {
  const res = await gh(token, `/git/blobs/${blobSha}`, 'application/vnd.github.raw+json');
  return res.text();
}
