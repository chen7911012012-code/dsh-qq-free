# dsh-qq-free · QQ 自由发言

> **原作者：都有文明每天** · 3645411938@qq.com
> 仓库：https://github.com/chen7911012012-code/dsh-qq-free
>
> 修改、分支或再分发此插件，必须在插件页 / README / 分发页面显著标明原作者「都有文明每天」和联系方式 3645411938@qq.com，并保留原仓库链接。见 [NOTICE.md](NOTICE.md) 与 [LICENSE](LICENSE)。

DSH 插件：让 **QQ 官方机器人**主动开口（不必等 @），内容由 DeepSeek 现写，并带一个网页控制台。

> 源码包名是 `@local/dsh-qq-free`；分发包/发布包名是 `dsh-qq-free`，两者功能相同、行 id 都是 `qq-free`，同一 profile 只装一个。

## 功能

- **主动消息**：走 QQ 开放平台 `/v2/groups/…`、`/v2/users/…`，不需要 `msg_id`，也不需要被 @；发送时可以顺带 @ 一个群成员，也可以发图片/表情包/视频/语音/文件。
- **自动发现新群**：机器人被拉进新群、收到新群消息或入群申请时，自动加入会话目标，面板 6 秒内刷新出来。
- **群 AI 问答**：群里只回 **@ 机器人** 的消息，回答开头用 Markdown 真正 @ 提问人；每条消息先判断提问/闲聊：提问强制 DeepSeek 准确回答，闲聊用智能体人设接话。
- **DeepSeek**：复用当前 profile 的 DSH 模型路由（默认 `deepseek-account` / `deepseek-flash`），围绕话题写一句；人设可改，网页里能直接试聊。
- **自动发言**：间隔、偏好话题、静默时段、每会话每日上限；开启后从当前时刻计时，也可「现在就来一句」。
- **问答库**：网页里维护「问题 → 答案」；群友 @ 机器人提问时先查库、命中即按库里的答案回，未命中再用 DeepSeek。网页可查库并一键发到 QQ。
- **自带 QQ AI 对话通道**：插件自己连 QQ 网关，私聊 / 群 @ 消息默认全部走 DeepSeek 回复（可选优先问答库；需先停用官方 QQ 插件，二选一）。
- **远程发言网页**：完整控制台，手机/外网浏览器用 token 登录后可发送（含本地图片/表情包/视频）、自动发言、问答、入群审批、违禁词、目标与板块设置。
- **入群欢迎与群管理**：有人入群按模板发欢迎语；有人申请入群时把「头像 + 昵称 + 时间 + 验证答案」发到对应群，管理员在群里回复「同意 昵称」/「拒绝 昵称」即可处理（面板审批可填操作人）；未同意的申请不会被自动删除，面板可手动移除；也支持禁言 / 解除禁言 / 踢人（需机器人是群管理员并开通对应权限）。
- **违禁词**：指定群里命中违禁词后，第 1 次撤回+警告，第 2 次撤回+禁言，第 3 次撤回+踢出。
- **入群验证**：指定群新成员需在 2 分钟内回复 6 位验证码，错误或超时自动移出。
- **权限与代管**：按群角色识别群主/管理员；可设置主人、添加代管；审批、禁言、踢人、群信息仅这些角色可用。
- **屏蔽成员**：指定群里完全忽略某个成员的消息（不回复、不执行命令）；也可以屏蔽「@ 了某人」的整条消息。
- **群功能屏蔽**：按群屏蔽指定功能，或一键屏蔽该群全部功能（聊天、自动发言、欢迎、入群通知、命令、违禁词、获取信息）。
- **@某人 获取信息**：群里「@某人 获取信息」回复该成员 openid 和入群时间。
- **云端同步**：源码改动约 3 秒直连提交到 GitHub，同时同步 WebDAV；GitHub Actions 每 5 分钟再从 WebDAV 兜底同步。
- **群板块**：把 1–3 个群组成板块，发送/生成/媒体/自动发言/远程网页可一次发到多个群。
- **智能体工具**：`qq_free_say` 主动发言、`qq_qa_lookup` 查问答库、`qq_qa_save` 记住一条问答；任意 DSH 会话可用。
- **网页控制台**：左侧栏「QQ 自由发言」、设置页栏目、插件详情入口；凭据、目标、发送、生成、自动发言、发送记录都在里面。

## 安装

### 从 GitHub 安装（推荐）

- 打开 [Releases](https://github.com/chen7911012012-code/dsh-qq-free/releases/latest)，下载 `dsh-qq-free-<版本>.tgz`
- 或直接：

```powershell
npx @deepseek-ai/dsh plugin --profile <profile> add https://github.com/chen7911012012-code/dsh-qq-free/releases/latest/download/dsh-qq-free.tgz
```

### 从 DSH 插件市场安装

在本机 DSH 的插件市场源里加入：

```
https://chen7911012012-code.github.io/dsh-qq-free/market/index.json
```

然后在「插件 → 发现」里搜索「QQ 自动发言」即可一键安装。

### npm / 本地目录

```powershell
# 发布到 npm 之后
npx @deepseek-ai/dsh plugin --profile <profile> add dsh-qq-free

# 或本地目录
npx @deepseek-ai/dsh plugin --profile <profile> add C:\path\to\dsh-qq-free
```

也可以在 DSH「插件 → 添加插件」里选择本地目录。

## 快速开始

1. 打开面板，填 QQ 开放平台机器人的 AppID / AppSecret（或设置环境变量 `QQBOT_APPID`、`QQBOT_SECRET`），保存。
2. 「会话目标」里点「导入已知会话」，或手动粘贴 `group_openid` / `user_openid`。
3. 发一条，或让 DeepSeek 写一句再发。
4. 想让它自己说：打开「自动发言」，选目标、间隔、话题并保存。

## 限制

- 群消息事件能否收到取决于机器人权限；自带通道**只在真的 @ 机器人时回复**，普通群消息不插嘴（避免刷屏）。
- 只负责**主动发送**与自带通道的被动回复；如果继续用官方 QQ 插件，群里被 @ 的回复由官方插件处理。
- 主动消息受 QQ 平台频率/配额限制；插件另有一层每会话每日上限（默认 4，`0` 为不限）。

数据目录默认为 `~/.dsh/qq-free/`（有 `DSH_PROFILE_DIR` 时用 profile 下的 `.qq-free/`）。详细说明见 `docs/DETAIL.md`。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT（附署名要求），见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
