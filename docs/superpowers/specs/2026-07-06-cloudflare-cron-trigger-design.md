# Cloudflare Cron Trigger 设计文档

**日期：** 2026-07-06  
**状态：** 已批准

## 目标

将 mimotion 的定时调度从 GitHub Actions cron 迁移到 Cloudflare Cron Trigger，同时保留所有现有业务逻辑（Python main.py、token 持久化、推送通知）不变。

## 架构

```
Cloudflare Cron Trigger
        ↓ (按设定时间触发)
  CF Worker (worker/src/index.ts)
        ↓ POST GitHub API: workflow_dispatch
  GitHub Actions run.yml
        ↓
  Python main.py（不变）
        ↓
  commit encrypted_tokens.data 回 repo（不变）
```

## 组件

### 1. Cloudflare Worker (`worker/`)

**文件结构：**
```
worker/
  src/
    index.ts       # 主入口，scheduled handler
  wrangler.toml    # Worker 配置：cron、name、secrets 声明
  package.json
  tsconfig.json
```

**功能：** 接收 Cloudflare Cron 触发，调用 GitHub Actions API 触发 `workflow_dispatch`。

**GitHub API 调用：**
```
POST https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/actions/workflows/run.yml/dispatches
Authorization: Bearer {GITHUB_TOKEN}
Body: { "ref": "master" }
```

**Worker Secrets（通过 `wrangler secret put` 配置，不写入代码）：**
- `GITHUB_TOKEN` — GitHub PAT，需要 `actions:write` 权限
- `GITHUB_OWNER` — repo 所有者用户名
- `GITHUB_REPO` — 固定值 `mimotion`

**错误处理：** GitHub API 返回非 2xx 时抛出错误，Cloudflare 会记录到 Worker 日志。

### 2. Cron 时间表

沿用原 GitHub Actions 的执行时间（UTC）：

```
40 0,2,4,6,8,10,12 * * *
```

对应北京时间：08:40、10:40、12:40、14:40、16:40、18:40、20:40，每日 7 次。

### 3. GitHub Actions 变更

**`run.yml` 修改：** 删除 `schedule` trigger，只保留 `workflow_dispatch`：

```yaml
on:
  workflow_dispatch:
```

其他所有步骤（Python 安装、main.py 执行、token 持久化 commit）保持不变。

## 不变的内容

- `main.py` — 全部不动
- `util/` — 全部不动
- `encrypted_tokens.data` — 持久化方式不变（git commit）
- GitHub Actions job 逻辑 — 不变，只删除 schedule trigger

## 部署步骤概要

1. 初始化 `worker/` 目录（wrangler init）
2. 编写 `worker/src/index.ts`
3. 配置 `wrangler.toml`（name、cron、compatibility_date）
4. 通过 `wrangler secret put` 写入 GITHUB_TOKEN、GITHUB_OWNER、GITHUB_REPO
5. `wrangler deploy` 发布 Worker
6. 修改 `run.yml`，删除 schedule trigger
7. 验证：手动触发 Worker → 确认 GitHub Actions workflow 被触发

## 依赖

- Cloudflare 账号（免费套餐即可，cron 免费额度足够）
- GitHub PAT（需要 `Actions: Read and write` 权限）
- Wrangler CLI (`npm install -g wrangler`)
