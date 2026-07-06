export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
}

export async function triggerWorkflow(env: Env): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/run.yml/dispatches`;
  console.log(`[mimotion] triggering workflow: ${url}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'mimotion-cf-worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'master' }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error(`[mimotion] GitHub API error ${response.status}: ${text}`);
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }
  console.log(`[mimotion] workflow dispatched successfully (HTTP ${response.status})`);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log(`[mimotion] cron triggered at ${new Date().toISOString()}`);
    await triggerWorkflow(env);
  },
};
