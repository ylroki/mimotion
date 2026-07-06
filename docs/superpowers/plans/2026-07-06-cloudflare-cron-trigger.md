# Cloudflare Cron Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Cloudflare Cron Trigger 替代 GitHub Actions schedule，Worker 定时调用 GitHub API 触发 `workflow_dispatch`，Python 业务逻辑不变。

**Architecture:** 在 `worker/` 子目录创建一个极简 Cloudflare Worker；scheduled handler 向 GitHub API 发 POST 请求触发 `run.yml` workflow；KV、D1 均不需要，state 仍由 GitHub Actions 的 git commit 管理。

**Tech Stack:** TypeScript, Wrangler CLI v3+, Cloudflare Workers, Vitest (unit test), GitHub Actions API

## Global Constraints

- Worker 名称：`mimotion-trigger`
- Cron schedule（UTC）：`40 0,2,4,6,8,10,12 * * *`（北京时间 08:40-20:40，每 2 小时）
- GitHub workflow 文件：`run.yml`，目标分支：`master`
- Secrets 名称严格匹配：`GITHUB_TOKEN`、`GITHUB_OWNER`、`GITHUB_REPO`
- `wrangler` 版本 ≥ 3.0.0
- TypeScript strict mode

---

## File Map

| 路径 | 操作 | 职责 |
|------|------|------|
| `worker/package.json` | 新建 | 项目元数据、scripts、dev 依赖 |
| `worker/tsconfig.json` | 新建 | TypeScript 配置，引用 CF Workers 类型 |
| `worker/wrangler.toml` | 新建 | Worker 名称、入口、cron、compatibility_date |
| `worker/src/index.ts` | 新建 | `Env` 接口、`triggerWorkflow()`、default export |
| `worker/src/index.test.ts` | 新建 | `triggerWorkflow` 的单元测试（vitest） |
| `.github/workflows/run.yml` | 修改 | 删除 `schedule` trigger，只保留 `workflow_dispatch` |

---

## Task 1: Scaffold Worker + 实现 scheduled handler (TDD)

**Files:**
- Create: `worker/package.json`
- Create: `worker/tsconfig.json`
- Create: `worker/wrangler.toml`
- Create: `worker/src/index.ts`
- Create: `worker/src/index.test.ts`

**Interfaces:**
- Produces: `triggerWorkflow(env: Env): Promise<void>` — 供测试和 scheduled handler 调用

- [ ] **Step 1: 创建 `worker/package.json`**

```json
{
  "name": "mimotion-trigger",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "deploy": "wrangler deploy",
    "dev": "wrangler dev",
    "test": "vitest run"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0",
    "wrangler": "^3.0.0"
  }
}
```

- [ ] **Step 2: 创建 `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: 创建 `worker/wrangler.toml`**

```toml
name = "mimotion-trigger"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[triggers]
crons = ["40 0,2,4,6,8,10,12 * * *"]
```

- [ ] **Step 4: 安装依赖**

在 `worker/` 目录运行：

```bash
cd worker && npm install
```

Expected: `node_modules/` 生成，无报错

- [ ] **Step 5: 创建 stub `worker/src/index.ts`（让测试能 import）**

```typescript
export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
}

export async function triggerWorkflow(_env: Env): Promise<void> {
  throw new Error('not implemented');
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await triggerWorkflow(env);
  },
};
```

- [ ] **Step 6: 写失败测试 `worker/src/index.test.ts`**

```typescript
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
```

- [ ] **Step 7: 运行测试，确认失败**

```bash
cd worker && npm test
```

Expected: 2 tests FAIL，第一个报 `not implemented`，第二个报 `not implemented`

- [ ] **Step 8: 实现 `triggerWorkflow`**

将 `worker/src/index.ts` 替换为：

```typescript
export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
}

export async function triggerWorkflow(env: Env): Promise<void> {
  const url = `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/run.yml/dispatches`;
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
    throw new Error(`GitHub API error ${response.status}: ${text}`);
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    await triggerWorkflow(env);
  },
};
```

- [ ] **Step 9: 运行测试，确认全部通过**

```bash
cd worker && npm test
```

Expected:
```
✓ triggerWorkflow > POSTs to GitHub workflow dispatch endpoint with correct headers
✓ triggerWorkflow > throws with status code when GitHub API returns error
Test Files  1 passed (1)
Tests       2 passed (2)
```

- [ ] **Step 10: 验证 TypeScript 类型检查通过**

```bash
cd worker && npx tsc --noEmit
```

Expected: 无输出，exit code 0

- [ ] **Step 11: Commit**

```bash
git add worker/
git commit -m "feat: add Cloudflare Worker cron trigger for mimotion"
```

---

## Task 2: 移除 GitHub Actions schedule trigger

**Files:**
- Modify: `.github/workflows/run.yml`

**Interfaces:**
- Consumes: 无
- Produces: `run.yml` 只保留 `workflow_dispatch`，可被 Worker 触发

- [ ] **Step 1: 编辑 `.github/workflows/run.yml`**

将 `on:` 块从：

```yaml
on:
  schedule:
    - cron: '40 0,2,4,6,8,10,12 * * *'
  workflow_dispatch:
```

修改为：

```yaml
on:
  workflow_dispatch:
```

（只删 schedule 块，其他内容不动）

- [ ] **Step 2: 验证文件改动正确**

```bash
grep -n "schedule\|workflow_dispatch\|cron" .github/workflows/run.yml
```

Expected: 只看到 `workflow_dispatch`，不出现 `schedule` 或 `cron`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/run.yml
git commit -m "ci: remove GitHub Actions schedule, use Cloudflare Cron Trigger instead"
```

---

## Task 3: 配置 Secrets 并部署 Worker

> 此 task 需要 Cloudflare 账号已登录（`wrangler login`）以及 GitHub PAT 准备好。

**Files:**
- 无文件修改（secrets 存储在 Cloudflare 云端）

**Interfaces:**
- Consumes: `wrangler.toml`（Task 1 产物）
- Produces: 已部署的 Worker，附带 cron trigger

- [ ] **Step 1: 登录 Cloudflare（若尚未登录）**

```bash
cd worker && npx wrangler login
```

Expected: 浏览器打开 Cloudflare OAuth 页面，授权后终端显示 `Successfully logged in`

- [ ] **Step 2: 写入 GITHUB_TOKEN secret**

```bash
cd worker && npx wrangler secret put GITHUB_TOKEN
```

Expected: 提示 `Enter a secret value:` → 粘贴 GitHub PAT（需要 `Actions: Read and write` 权限）→ 显示 `✓ Success! Uploaded secret GITHUB_TOKEN`

如何创建 PAT：GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → 选择 mimotion repo → Permissions → Actions: Read and write

- [ ] **Step 3: 写入 GITHUB_OWNER secret**

```bash
cd worker && npx wrangler secret put GITHUB_OWNER
```

Expected: 输入你的 GitHub 用户名 → 显示 `✓ Success! Uploaded secret GITHUB_OWNER`

- [ ] **Step 4: 写入 GITHUB_REPO secret**

```bash
cd worker && npx wrangler secret put GITHUB_REPO
```

Expected: 输入 `mimotion` → 显示 `✓ Success! Uploaded secret GITHUB_REPO`

- [ ] **Step 5: 部署 Worker**

```bash
cd worker && npx wrangler deploy
```

Expected 输出类似：
```
Total Upload: ~1 KiB / gzip: ~0.5 KiB
Uploaded mimotion-trigger (...)
Published mimotion-trigger (...)
  schedule: 40 0,2,4,6,8,10,12 * * *
```

- [ ] **Step 6: 手动触发验证**

使用 wrangler 本地模拟触发 scheduled event：

```bash
cd worker && npx wrangler dev --test-scheduled
```

另开终端：

```bash
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Expected: 终端日志无 error，GitHub repo 的 Actions tab 出现一条新的 `workflow_dispatch` 触发的 run（名称含 `刷步数`）

- [ ] **Step 7: 确认 Cloudflare dashboard 显示 cron**

访问 Cloudflare Workers dashboard → `mimotion-trigger` → Triggers 标签，确认 cron `40 0,2,4,6,8,10,12 * * *` 已列出

- [ ] **Step 8: Push 到 remote**

```bash
git push origin master
```

Expected: push 成功，GitHub Actions 不自动触发（已删 schedule），只会在下一个整点 40 分由 Cloudflare 触发
