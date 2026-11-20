export interface GitHubRepoConfig {
  configured: boolean;
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface GitHubFileUpsert {
  repoPath: string;
  content: Buffer;
}

export interface GitHubCommitResult {
  commitSha: string;
  commitUrl: string;
}

export function getGitHubRepoConfig(
  env: Record<string, string | undefined> = process.env
): GitHubRepoConfig {
  const token = (env.GITHUB_TOKEN || '').trim();
  const owner = (env.GITHUB_OWNER || '').trim();
  const repo = (env.GITHUB_REPO || '').trim();
  const branch = (env.GITHUB_BRANCH || env.GITHUB_BASE_BRANCH || 'main').trim() || 'main';
  return {
    configured: Boolean(token && owner && repo),
    token,
    owner,
    repo,
    branch
  };
}

async function githubFetch<T>(
  config: GitHubRepoConfig,
  apiPath: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; errorText?: string }> {
  const url = `https://api.github.com${apiPath}`;
  const resp = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HACHIHI-Template-Admin',
      ...(init?.headers || {})
    }
  });
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => '');
    return { ok: false, status: resp.status, data: null, errorText };
  }
  const data = (await resp.json().catch(() => null)) as T | null;
  return { ok: true, status: resp.status, data };
}

export async function listGitHubDirectoryTree(
  config: GitHubRepoConfig,
  dirPrefix = 'public/templates'
): Promise<{
  headCommitSha: string;
  files: Array<{ path: string; sha: string; size?: number }>;
}> {
  const refRes = await githubFetch<{ object?: { sha?: string } }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/ref/heads/${encodeURIComponent(config.branch)}`
  );
  if (!refRes.ok || !refRes.data?.object?.sha) {
    throw new Error(
      `Không đọc được nhánh GitHub "${config.branch}" (${refRes.status}): ${refRes.errorText || 'Kiểm tra GITHUB_TOKEN/GITHUB_OWNER/GITHUB_REPO.'}`
    );
  }
  const headCommitSha = refRes.data.object.sha;

  const commitRes = await githubFetch<{ tree?: { sha?: string } }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/commits/${headCommitSha}`
  );
  if (!commitRes.ok || !commitRes.data?.tree?.sha) {
    throw new Error(`Không đọc được commit tree từ GitHub (${commitRes.status}).`);
  }

  const treeRes = await githubFetch<{
    tree?: Array<{ path: string; type: string; sha: string; size?: number }>;
  }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/trees/${commitRes.data.tree.sha}?recursive=1`
  );
  if (!treeRes.ok || !Array.isArray(treeRes.data?.tree)) {
    throw new Error(`Không đọc được danh sách tệp từ GitHub Tree API (${treeRes.status}).`);
  }

  const normalizedPrefix = dirPrefix.replace(/\/+$/, '') + '/';
  const files = treeRes.data.tree
    .filter(item => item.type === 'blob' && item.path.startsWith(normalizedPrefix))
    .map(item => ({ path: item.path, sha: item.sha, size: item.size }));

  return { headCommitSha, files };
}

export async function readGitHubBlobBuffer(
  config: GitHubRepoConfig,
  blobSha: string
): Promise<Buffer> {
  const res = await githubFetch<{ content?: string; encoding?: string }>(
    config,
    `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/git/blobs/${blobSha}`
  );
  if (!res.ok || !res.data?.content) {
    throw new Error(`Không tải được blob ${blobSha} từ GitHub (${res.status}).`);
  }
  return Buffer.from(res.data.content.replace(/\n/g, ''), 'base64');
}

export async function commitTemplateChangesAtomicallyToGitHub(
  config: GitHubRepoConfig,
  options: {
    upserts: GitHubFileUpsert[];
    deletePaths?: string[];
    message: string;
    expectedHeadSha?: string;
  }
): Promise<GitHubCommitResult> {
  const { owner, repo, branch } = config;
  const repoBase = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // 1. Get current branch HEAD commit SHA
  const refRes = await githubFetch<{ object?: { sha?: string } }>(
    config,
    `${repoBase}/git/ref/heads/${encodeURIComponent(branch)}`
  );
  if (!refRes.ok || !refRes.data?.object?.sha) {
    throw new Error(`Không truy cập được nhánh "${branch}" trên GitHub (${refRes.status}).`);
  }
  const headCommitSha = refRes.data.object.sha;

  if (options.expectedHeadSha && options.expectedHeadSha !== headCommitSha) {
    const err = new Error('Nhánh GitHub vừa có thay đổi mới từ phiên khác. Vui lòng tải lại danh sách mẫu và thử lại.');
    (err as Error & { statusCode?: number }).statusCode = 409;
    throw err;
  }

  // 2. Get base tree SHA
  const commitRes = await githubFetch<{ tree?: { sha?: string } }>(
    config,
    `${repoBase}/git/commits/${headCommitSha}`
  );
  if (!commitRes.ok || !commitRes.data?.tree?.sha) {
    throw new Error(`Không lấy được base tree SHA từ GitHub (${commitRes.status}).`);
  }
  const baseTreeSha = commitRes.data.tree.sha;

  // 3. Upload blobs in parallel for all upserts
  const treeEntries: Array<{
    path: string;
    mode: '100644';
    type: 'blob';
    sha: string | null;
  }> = [];

  const createdBlobs = await Promise.all(
    options.upserts.map(async file => {
      const blobRes = await githubFetch<{ sha?: string }>(config, `${repoBase}/git/blobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: file.content.toString('base64'),
          encoding: 'base64'
        })
      });
      if (!blobRes.ok || !blobRes.data?.sha) {
        throw new Error(`Không tạo được Git blob cho ${file.repoPath} (${blobRes.status}).`);
      }
      return { path: file.repoPath, sha: blobRes.data.sha };
    })
  );

  for (const item of createdBlobs) {
    treeEntries.push({
      path: item.path,
      mode: '100644',
      type: 'blob',
      sha: item.sha
    });
  }

  // 4. Mark deletions in Git Tree (`sha: null`)
  const upsertSet = new Set(options.upserts.map(u => u.repoPath));
  for (const delPath of options.deletePaths || []) {
    if (!upsertSet.has(delPath)) {
      treeEntries.push({
        path: delPath,
        mode: '100644',
        type: 'blob',
        sha: null
      });
    }
  }

  // 5. Create new tree
  const treeRes = await githubFetch<{ sha?: string }>(config, `${repoBase}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries
    })
  });
  if (!treeRes.ok || !treeRes.data?.sha) {
    throw new Error(`Không tạo được Git Tree trên GitHub (${treeRes.status}): ${treeRes.errorText || ''}`);
  }

  // 6. Create atomic commit
  const newCommitRes = await githubFetch<{ sha?: string; html_url?: string }>(
    config,
    `${repoBase}/git/commits`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: options.message,
        tree: treeRes.data.sha,
        parents: [headCommitSha]
      })
    }
  );
  if (!newCommitRes.ok || !newCommitRes.data?.sha) {
    throw new Error(`Không tạo được commit trên GitHub (${newCommitRes.status}).`);
  }

  // 7. Fast-forward branch ref (force: false guarantees no overwrite of concurrent commits)
  const patchRes = await githubFetch<{ object?: { sha?: string } }>(
    config,
    `${repoBase}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sha: newCommitRes.data.sha,
        force: false
      })
    }
  );
  if (!patchRes.ok) {
    const err = new Error(
      patchRes.status === 422
        ? 'Xung đột commit trên nhánh chính GitHub (409). Vui lòng tải lại trang quản trị và thử lại.'
        : `Không cập nhật được nhánh "${branch}" trên GitHub (${patchRes.status}).`
    );
    (err as Error & { statusCode?: number }).statusCode = patchRes.status === 422 ? 409 : 502;
    throw err;
  }

  return {
    commitSha: newCommitRes.data.sha,
    commitUrl:
      newCommitRes.data.html_url ||
      `https://github.com/${owner}/${repo}/commit/${newCommitRes.data.sha}`
  };
}
