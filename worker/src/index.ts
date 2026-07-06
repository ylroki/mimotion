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

// cron has no year field, so one-off date skips are handled here instead
const SKIP_DATE = '2026-07-06';

function getBeijingDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date);
}

export default {
  async fetch(): Promise<Response> {
    return new Response('mimotion-trigger: cron-only worker', { status: 200 });
  },
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    console.log(`[mimotion] cron triggered at ${now.toISOString()}`);
    if (getBeijingDateString(now) === SKIP_DATE) {
      console.log(`[mimotion] skipping trigger, ${SKIP_DATE} is in the skip list`);
      return;
    }
    await triggerWorkflow(env);
  },
};
