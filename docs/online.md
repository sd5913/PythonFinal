# Cloudflare 在线联机

Python Worker 和局域网服务器共用网页以及 `app/game.py` 中的 Python 游戏规则。局域网仍以 `python run.py` 启动。

## 无账号运行测试

安装 Node.js 22 或 24，然后运行：

```sh
npm ci
npm run test:worker
```

测试运行 Wrangler 和本地 workerd，应用 D1 迁移，并使用独立的本地 GitHub fixture。首次启动可能需要从 Cloudflare 下载 `2026-09-04` 兼容日期对应的 Pyodide 运行时。项目使用该运行时随附的 Python Workers SDK，Worker 没有额外的 Python 包依赖。测试为每次运行创建独立的临时数据库，重启测试保留该次运行的持久化目录。局域网与房间单元测试使用原项目的 Python 测试命令：

```sh
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

## 在本机使用 GitHub 登录

1. 运行 `npm ci`。
2. 在 [GitHub Developer settings](https://github.com/settings/developers) 创建个人 **OAuth App**。Homepage URL 设为 `http://127.0.0.1:8787`。Authorization callback URL 设为 `http://127.0.0.1:8787/api/auth/github/callback`。
3. 将 `.dev.vars.example` 复制成被 Git 忽略的 `.dev.vars`，填入 `GITHUB_CLIENT_ID` 与 `GITHUB_CLIENT_SECRET`。保持 `wrangler.json` 的 `APP_URL` 为 `http://127.0.0.1:8787`。
4. 运行以下命令，然后打开 `http://127.0.0.1:8787`。登录过程中保持地址一致。

```sh
npm run db:migrate:local
npm run dev
```

房主点击「创建房间」后，点击「分享邀请」并自行发给队友。队友打开邀请链接、登录并点击「接受邀请」。两名或以上成员准备后，房主可以开始。使用两个浏览器档案或普通窗口和无痕窗口测试不同账号。

D1 的 `DB` 绑定保存 GitHub 数字 ID、登录名、散列后的会话与邀请查询键以及到期时间。每个房间有一个 `ROOMS` Durable Object，保存独立的席位和对局。使用 GitHub OAuth 应用的公开身份权限，授权请求发送空 scope，启用 S256 PKCE。OAuth 状态绑定浏览器并在十分钟内只能使用一次。GitHub 访问令牌仅用于获取账号资料。应用会话为 12 小时，线上 Cookie 使用 Secure、HttpOnly 与 SameSite=Lax，本机回环 HTTP 使用后两项。

房间有四个席位和六小时上限。创建或加入后应在 30 秒内连接。首次连接后，每次心跳或有效操作续约两分钟。断线后可在席位过期前使用同一 GitHub 账号和房间恢复。刷新同一浏览器标签页会自动尝试恢复。主动退出或席位到期会释放位置并将进行中的对局重置到大厅。最后一个席位释放时清理房间，房主离席后由下一名成员接任。线上对局保留最近 200 条日志。任何持有有效链接并登录的玩家都可以在对局开始前尝试加入，直到房间关闭。邀请使用 URL 片段，由网页读取后通过同源 POST 发送。

Durable Object 创建成功后才向 D1 登记房间。若登记失败，未连接的席位由闹钟回收。若对象已关闭而 D1 清理暂时失败，加入仍会被对象拒绝，到期行由定时清理删除。对象存储与 D1 各自提交。应用限制入站游戏消息为 4 KiB。每条操作和心跳会使用 D1 检查会话，广播会检查各收件人。部署前核对所选套餐的 D1 读取、Durable Objects 请求与存储配额。线上休眠和重启行为需在部署后验收。参见 [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/) 和 [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)。

## 首次授权部署

团队审核并合并后，由有权限的成员执行这些步骤。请准备自己的 Cloudflare 账号、D1 和生产 GitHub OAuth App。

1. 运行 `npx wrangler login` 登录 Cloudflare。在 Cloudflare 建立 Worker 子域名并选定 Worker 名称及 HTTPS 地址。运行 `npx wrangler d1 create pythonfinal-online`，记录返回的数据库名称和 UUID。
2. 复制 `wrangler.json` 为被 Git 忽略的 `wrangler.production.json`。将 `name` 改为选定的 Worker 名称，更新 D1 条目的 `database_name` 和 `database_id`，将 `vars.APP_URL` 改为正式 HTTPS origin。保留 `DB`、`ROOMS` 与 `ASSETS` 三个绑定和 `v1` 的 `new_sqlite_classes: ["RoomObject"]` 迁移。
3. 用生产地址创建独立的 GitHub OAuth App。Homepage URL 是 `APP_URL`。Authorization callback URL 是 `APP_URL` 加上 `/api/auth/github/callback`。将 Client ID 填入生产配置的 `vars.GITHUB_CLIENT_ID`。生成 Client Secret，存为 Worker secret `GITHUB_CLIENT_SECRET`。生产配置及 secret 只由团队管理。
4. 应用远程 D1 迁移，然后从仅当前用户可读的临时 JSON 文件上传 Worker secret。JSON 的唯一键是 `GITHUB_CLIENT_SECRET`，值为生产 Client Secret。部署后删除临时文件。

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.json
npx wrangler deploy --config wrangler.production.json --secrets-file /path/to/temporary-secrets.json
```

5. 开启正式 HTTPS 地址，使用独立浏览器档案验证 GitHub 登录、建房、邀请、开始与断线恢复。检查第二个房间仍可独立运行。线上第一轮验收应记录测试的地址、版本和实际观察结果。

参考 [课程 GitHub OAuth + D1 示例](https://github.com/sd5913/github-oauth-d1-template)、[GitHub OAuth Web application flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#web-application-flow)、[Python Workers](https://developers.cloudflare.com/workers/languages/python/)、[Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) 与 [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。
