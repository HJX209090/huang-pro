# huang-pro

huang++pro 本地桌面应用（Electron + Vue）。

## 开发

```bash
npm install
npm run dev
```

## 打包

```bash
npm run build:win
```

产物在 `release/`：

- `huang++pro-*-setup.exe` 安装版（支持自动更新）
- `huang++pro-*-portable.exe` 免安装版

## 发布更新（给用户自动升级）

> 重要：账号**密码不能**用来调 GitHub API（会 404）。请用 **Personal Access Token**。  
> 仓库需要设为 **Public**，否则用户端检查更新也会 404。

1. GitHub → Settings → General → Danger Zone → **Change repository visibility → Public**
2. 打开 https://github.com/settings/tokens → Generate new token (classic)  
   勾选 `repo`，复制 `ghp_...`
3. 修改 `package.json` 的 `version`（例如 `0.1.2` → `0.1.3`）
4. 发布：

```bash
set GH_TOKEN=ghp_你的token
npm run release:win
```

5. 用户打开**安装版**联网后：
   - 已是最新 → 安静 / 手动点「检查更新」会提示已是最新
   - 有新版本 → 弹窗询问，用户点「立即更新」才下载安装

## 达人账号登录态

- 添加抖音账号时填写**账号+密码**并登录一次
- 定时发布会先检测分区 cookie；过期则自动填密重登
- 达人工作台与创作者中心共用同一登录分区

## 豆包验证码

生成过程中出现拖拽/点选验证弹窗时，会自动识别 iframe 内图片并拖到投放区后提交。失败会刷新重试；仍失败才把窗口置前等人拖一下。
