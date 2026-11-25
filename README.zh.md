# 🦴 Spine MCP Server

[![中文](https://img.shields.io/badge/lang-中文-red)](README.zh.md) [![EN](https://img.shields.io/badge/lang-EN-blue)](README.md)

> 适用于 macOS 和 Windows 的 Spine 4.3.x / 3.8.x 动画工作流服务 · 供 Trae / Cursor / Claude Desktop / Codex / Windsurf / Cline 等 AI 客户端直接调用 Spine 编辑器能力

[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org) [![Spine](https://img.shields.io/badge/Spine-4.3.x%20%7C%203.8.x-yellow)](https://esotericsoftware.com) [![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

---

## 📖 简介

**Spine MCP Server** 是一个基于 [MCP（Model Context Protocol）](https://modelcontextprotocol.io) 的服务器，把 **Spine Professional** 的编辑器能力封装成 70 个工具，让 AI 可以直接：

- 读取 Spine 项目（骨骼 / 插槽 / 皮肤 / 动画 / 事件 / 约束）
- 修改动画关键帧（旋转 / 位移 / 缩放 / 切变 / 曲线）
- 编辑骨架结构（增删骨骼 / 插槽 / 附件 / 皮肤 / 换装）
- 操作约束（IK / 变换 / 路径）与网格（FFD 变形）
- 图集拆分（立绘拆部件）、自动绑骨、图集重打包
- JS 运行时渲染动画预览帧
- 通过 Cocos Creator 扩展面板一键配置 / 启停服务 / 生成 AI 客户端配置

## ✨ 特性

| 能力 | 说明 |
|---|---|
| 70 个 MCP 工具 | 覆盖 Spine 全部功能域（信息/骨架/附件/约束/动画/图集/项目） |
| Round-Trip 修改 | 导出 JSON → 修改 → 原地导入，**自动备份**（`.bak`） |
| 版本兼容 | 按编辑器版本处理 4.3 和 3.8 的 CLI 参数、关键帧及约束格式 |
| Cocos 扩展 | Cocos Creator 3.8+ 可视化面板 + `.ccx` 打包 |
| 安装向导 | 一键检测环境 + 写入配置 |

## 🔧 环境要求

- Node.js 20 或更新版本，以及已激活的 Spine Professional。macOS 实测环境为 Apple Silicon 和 Spine 4.3.26。
- Cocos Creator 3.8+ 仅用于可选的 Cocos 扩展面板。

## macOS 快速开始

在本仓库目录执行以下命令。

```sh
npm ci
npm run build
node dist/index.js check
node dist/index.js info "/绝对路径/角色.spine"
```

程序会查找 `/Applications/Spine.app` 和 `~/Applications/Spine.app`。macOS 默认使用编辑器 4.3.26。若团队使用其他补丁版本，在 `.env` 或 MCP 客户端环境中设置 `SPINE_VERSION` 为完整版本号。自定义安装位置可通过 `SPINE_EXE` 指定 `.app` 或其中的 `Contents/MacOS/Spine`。Windows 支持 `Spine.com`，保留启动器原有默认版本，也可固定 `SPINE_VERSION=3.8.75`。`npm run installer` 可自动生成 `.env`。

## MCP 客户端配置

将 `args` 中的入口改成当前克隆的绝对路径。如果桌面客户端找不到 `node`，把 `command` 改成 `command -v node` 的输出。

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["/绝对路径/spine-mcp-server-macos/dist/index.js", "mcp"],
      "env": { "SPINE_VERSION": "4.3.26" }
    }
  }
}
```

4.3 的新增和更新动画通过官方 CLI 按动画导入。修改骨架结构、删除或重命名动画时会用导出的 JSON 替换选定骨架，编辑器专有设置可能无法通过 JSON 往返。已有项目会先在同目录的副本上完成导入，保存 `.bak` 后替换项目。大型骨架整体导入可以通过 `CLI_TIMEOUT_MS` 调整超时。

运行 `npm run test:unit` 检查 JSON 和图集兼容性。`npm run test:4.3` 使用本机 Spine 走完整的 MCP 读写流程，并在临时工程中验证多个骨架和备份。4.3 的纹理预览使用官方 4.3 Canvas runtime 和 `canvas`，支持多页图集。

Spine 4.3 的 CLI `export` 子命令可用 `texture` 导出 PNG 序列，用 `video` 导出 MOV。MCP 工具 `spine_export_video` 也可通过 FFmpeg 导出 MP4 或 WebM。

## 🧩 工具一览（70 个）

| 分类 | 工具 |
|---|---|
| 信息查询 (9) | get_project_info · inspect_json · describe · list_animations · list_events · list_constraints · get_attachments · get_animation_detail · render_preview |
| 骨架结构 (10) | control_bone · add_bone · delete_bone · set_bone · mirror_bones · add_slot · delete_slot · set_slot · rename_slot · batch_rename |
| 附件与皮肤 (7) | set_attachment · add_attachment · delete_attachment · set_attachment_transform · edit_mesh · set_skin · import_skin |
| 约束 (9) | add/set/delete × {ik, transform, path} |
| 动画 (19) | add_simple_animation · generate_animation · list_effects · apply_effect · pose_to_animation · mirror_animation · mix_animations · mesh_wave · export_sheet · duplicate/delete/rename_animation · set_animation_settings · control_slot · control_constraint · add_event_keyframe · set_draw_order · set_curve · export_video |
| 工作流 (2) | check_project · pipeline |
| 图集与项目 (9) | split_atlas · repack_atlas · import_image · export · import · clean · create_project · scale_project · rollback |
| Cocos 工具链 (5) | list_cocos_assets · validate_references · build_skeleton · cut_parts · assemble |

## 🎮 Cocos 扩展

`cocos-extension/` 提供 Cocos Creator 3.8+ 面板：

- 安装：扩展管理器 → 本地扩展 → 添加 `cocos-extension` 目录（或 `npm run package:ccx` 生成 `.ccx` 导入）
- 功能：启动 MCP 服务 / 扫描项目 / 生成 AI 配置 / 服务状态
- 详见 [docs/cocos-extension-README.md](docs/cocos-extension-README.md)

## 🧪 测试

```bash
npm run test:all     # 单元测试与当前版本的集成测试
npm run test:unit    # 单元测试（node:test）
```

在 macOS 上，4.3 集成测试通过 MCP 创建双骨架工程，写入并重新读取动画和骨架，检查备份，并验证导入失败后仍能读回原文件。3.8 集成测试使用 Windows 版 Spine 安装目录中的示例工程。

## 📚 文档

- [3.8 版用户手册（中文）](docs/USER_MANUAL.md)
- [3.8 User Manual (EN)](docs/USER_MANUAL.en.md)
- [Cocos 扩展说明 (中文)](docs/cocos-extension-README.md)
- [Cocos Extension README (EN)](docs/cocos-extension-README.en.md)

## 🗂 项目结构

```
├── src/                  # 源码（TS）
│   ├── server.ts         # MCP stdio 服务器
│   ├── spine/            # 核心：cli-executor / json-handler / export / import / render / split ...
│   ├── tools/            # 70 个工具（registry.ts 注册）
│   └── utils/            # 配置 / 日志 / 错误码 / 文件工具
├── cocos-extension/      # Cocos Creator 扩展（面板）
├── scripts/              # 安装向导 / .ccx 打包
├── tests/                # 全部测试套件
└── docs/                 # 文档
```

## 💰 购买支持

在 [Swarms Marketplace](https://swarms.world/agent/c44211d8-0ed5-4948-8c4e-10e63f465bc3) 购买支持本项目

## 📄 License

MIT
