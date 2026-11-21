# dsh-qq-free 分发说明（简体中文）

源码在上一级目录（`../`）。本目录是可直接分发/安装的产物，重新生成：

```powershell
node tools/build-publish.mjs
```

## 产物

| 路径 | 用途 |
|---|---|
| `dsh-qq-free-1.14.0-portable.zip` | **推荐分发**：解压得到 `dsh-qq-free/` 和安装说明 |
| `dsh-qq-free-1.14.0.tgz` | 单文件 npm 包，`dsh plugin add <tgz>` 用 |
| `dsh-qq-free-1.14.0.zip` | 插件目录压缩包 |
| `INSTALL.md` / `INSTALL.txt` / `INSTALL.pdf` | 安装说明（简体中文） |
| `SHA256SUMS.txt` | 校验值 |

## 安装

```powershell
dsh plugin --profile <profile> add D:\path\to\dsh-qq-free-1.14.0.tgz
```

或解压目录后在 DSH「插件 → 添加插件」里选择 `dsh-qq-free` 目录。

## 校验

```powershell
Get-FileHash .\dsh-qq-free-1.14.0-portable.zip -Algorithm SHA256
```

对比 `SHA256SUMS.txt`。

## 注意

- 自带 QQ AI 对话通道需要先在「插件」里停用官方 QQ 机器人插件（同一个 AppID 不能有两个消息接收方）
- 凭据、目标、问答库、日志保存在本机数据目录，不会打进安装包
- 详细步骤见 `INSTALL.md` / `INSTALL.txt` / `INSTALL.pdf`
