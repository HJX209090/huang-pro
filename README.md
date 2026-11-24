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

1. 修改 `package.json` 里的 `version`（例如 `0.1.0` → `0.1.1`）
2. 本机登录 GitHub，并准备好有 `repo` 权限的 Token：
   ```bash
   set GH_TOKEN=你的github_token
   npm run release:win
   ```
3. 脚本会打包并把安装包发布到 GitHub Releases
4. 用户打开已安装的软件（联网）会自动检查更新；也可点顶栏「检查更新」

> 自动更新依赖 **安装版 setup.exe**。免安装 portable 建议引导用户到 Releases 页手动下载。
