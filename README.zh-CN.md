# GitHub Desktop 中文汉化补丁（macOS 版）

非官方的 **GitHub Desktop 3.6.10 (macOS)** 简体中文汉化补丁。共替换 **2405 处 / 1874 条不同文案**（主进程菜单 121 处、主窗口 UI 2278 处、崩溃页 6 处），另修正 3 处 Electron role 生成的英文菜单标签。

Windows 版补丁包无法直接用于 macOS：载荷哈希不同、安装器是 PowerShell、菜单源串带 `&` 助记符、英文文案大小写也有差异。本项目用同一套词库与翻译引擎，针对 macOS 构建重新生成并逐字节校验。

## 快速开始

```bash
git clone https://github.com/banshilinghun/github-desktop-zh-mac.git
cd github-desktop-zh-mac

# 先完全退出 GitHub Desktop（⌘Q），然后：
./install.sh          # 安装（默认 /Applications/GitHub Desktop.app）
./install.sh --verify # 只校验，不改文件
./install.sh --restore # 还原英文原版
```

详细原理、坑与排错见 **[docs/使用说明.txt](docs/使用说明.txt)**；英文说明见 [README.md](README.md)。

## 已验证

- `node --check` 语法校验、AST 结构等价比对（除字符串字面量外程序结构不变）
- source map 逐串定位来源，只替换白名单内的界面文案
- 可复现构建：同一原文 + 同一词库 → 逐字节一致
- 安装 / 还原 / 重复执行幂等；哈希拦截；失败回滚
- 应用实际启动并渲染中文界面（欢迎页、菜单栏、侧栏、右键菜单截图核对）

## 许可

MIT。翻译引擎与基础词库改编自 [Johnserf-Seed/GitHub-Desktop-Chinese-Language-Pack](https://github.com/Johnserf-Seed/GitHub-Desktop-Chinese-Language-Pack)（MIT）。非官方汉化，与 GitHub 无隶属关系。
