import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerWorkflow } from './index.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.resetAllMocks();
});

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_OWNER: 'test-owner',
  GITHUB_REPO: 'test-repo',
};

describe('triggerWorkflow', () => {
  it('POSTs to GitHub workflow dispatch endpoint with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    await triggerWorkflow(env);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/test-owner/test-repo/actions/workflows/run.yml/dispatches',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ ref: 'master' }),
      }),
    );
  });

  it('throws with status code when GitHub API returns error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Unprocessable Entity',
    });

    await expect(triggerWorkflow(env)).rejects.toThrow('GitHub API error 422');
  });
});
