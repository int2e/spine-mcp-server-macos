# 🦴 Spine MCP Server

[![中文](https://img.shields.io/badge/lang-中文-red)](README.zh.md) [![EN](https://img.shields.io/badge/lang-EN-blue)](README.md)

> Spine 4.3.x and 3.8.x animation workflow server for macOS and Windows — lets AI clients (Trae / Cursor / Claude Desktop) directly control Spine.

[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933)](https://nodejs.org) [![Spine](https://img.shields.io/badge/Spine-4.3.x%20%7C%203.8.x-yellow)](https://esotericsoftware.com) [![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

---

## 📖 Overview

**Spine MCP Server** is a server built on the [MCP (Model Context Protocol)](https://modelcontextprotocol.io) that wraps **Spine Professional** editor capabilities into **70 MCP tools**, allowing AI clients to directly:

- Read Spine projects (bones, slots, skins, animations, events, constraints)
- Modify animation keyframes (rotation, translation, scale, shear, curves)
- Edit skeleton structure (add/delete bones, slots, attachments, skins, outfit swapping)
- Manipulate constraints (IK, transform, path) and meshes (FFD deformation)
- Split atlases (extract parts from character illustrations), auto-rig, repack atlases
- Render animation preview frames via JS runtime
- One-click configuration, start/stop service, and generate AI client configs via Cocos Creator extension panel

## ✨ Features

| Capability | Description |
|---|---|
| 70 MCP Tools | Covers all Spine domains (info, skeleton, attachments, constraints, animation, atlas, project) |
| Round-Trip Modification | Export JSON → Modify → In-place import, **automatic backup** (`.bak`) |
| Version Compatibility | Version-specific CLI arguments, keyframes and constraints for Spine 4.3 and 3.8 |
| Cocos Extension | Cocos Creator 3.8+ visual panel + `.ccx` packaging |
| Installer Wizard | One-click environment detection + config writing |

## 🔧 Requirements

- Node.js 20 or newer and an activated Spine Professional installation. The macOS integration was tested on Apple Silicon with Spine 4.3.26.
- Cocos Creator 3.8+ is optional for the Cocos extension panel.

## macOS quick start

Run these commands in the cloned repository.

```sh
npm ci
npm run build
node dist/index.js check
node dist/index.js info "/absolute/path/to/character.spine"
```

The server searches `/Applications/Spine.app` and `~/Applications/Spine.app`. macOS defaults to editor 4.3.26. Set `SPINE_VERSION` in `.env` or your MCP client to pin another exact patch. Set `SPINE_EXE` to a custom app bundle or its `Contents/MacOS/Spine` executable. Windows supports `Spine.com` and keeps the launcher's default editor unless pinned, for example with `SPINE_VERSION=3.8.75`. Run `npm run installer` to generate a local `.env`.

## MCP client configuration

Replace the server entry point with the absolute path to your clone. For desktop clients with a limited PATH, set `command` to the output of `command -v node`.

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/spine-mcp-server-macos/dist/index.js", "mcp"],
      "env": { "SPINE_VERSION": "4.3.26" }
    }
  }
}
```

On 4.3, adding or updating animations uses the editor's animation import. Structural edits and animation removal or renaming replace the selected skeleton from exported JSON. Editor-only settings can be lost in that skeleton. Imports into existing projects run on a sibling copy and create a `.bak` before replacing the project. Increase `CLI_TIMEOUT_MS` for full imports of large rigs.

`npm run test:unit` checks JSON and atlas compatibility. `npm run test:4.3` exercises MCP and the local editor on a temporary multi-skeleton project, including a backup check. Textured 4.3 previews use the official 4.3 Canvas runtime with `canvas` and support multi-page atlases.

On Spine 4.3, the CLI `export` command supports `texture` for PNG sequences and `video` for MOV. The `spine_export_video` MCP tool can also encode MP4 and WebM using FFmpeg.

## 🧩 Tools (70)

| Category | Tools |
|---|---|
| Information (9) | get_project_info · inspect_json · describe · list_animations · list_events · list_constraints · get_attachments · get_animation_detail · render_preview |
| Skeleton Structure (10) | control_bone · add_bone · delete_bone · set_bone · mirror_bones · add_slot · delete_slot · set_slot · rename_slot · batch_rename |
| Attachments & Skins (7) | set_attachment · add_attachment · delete_attachment · set_attachment_transform · edit_mesh · set_skin · import_skin |
| Constraints (9) | add/set/delete × {ik, transform, path} |
| Animation (19) | add_simple_animation · generate_animation · list_effects · apply_effect · pose_to_animation · mirror_animation · mix_animations · mesh_wave · export_sheet · duplicate/delete/rename_animation · set_animation_settings · control_slot · control_constraint · add_event_keyframe · set_draw_order · set_curve · export_video |
| Workflow (2) | check_project · pipeline |
| Atlas & Project (9) | split_atlas · repack_atlas · import_image · export · import · clean · create_project · scale_project · rollback |
| Cocos Toolchain (5) | list_cocos_assets · validate_references · build_skeleton · cut_parts · assemble |

## 🎮 Cocos Extension

The `cocos-extension/` directory provides a Cocos Creator 3.8+ panel:

- **Installation**: Extension Manager → Local Extension → Add `cocos-extension` directory (or run `npm run package:ccx` to generate a `.ccx` file for import)
- **Features**: Start/stop MCP service, scan projects, generate AI config, service status
- See [docs/cocos-extension-README.en.md](docs/cocos-extension-README.en.md) for details

## 🧪 Tests

```bash
npm run test:all     # Unit tests and integration tests for the configured editor
npm run test:unit    # Unit tests only (node:test)
```

On macOS, the 4.3 integration test creates a two-skeleton project via MCP, writes and reads back animation and setup edits, verifies the backup, and checks that a failed import preserves the project. The 3.8 integration tests use the sample projects bundled with the Windows editor.

## 📚 Docs

- [3.8 User Manual (EN)](docs/USER_MANUAL.en.md)
- [3.8 版用户手册（中文）](docs/USER_MANUAL.md)
- [Cocos Extension README (EN)](docs/cocos-extension-README.en.md)
- [Cocos Extension README (中文)](docs/cocos-extension-README.md)


## 🗂 Project Structure

```
├── src/                  # Source code (TypeScript)
│   ├── server.ts         # MCP stdio server
│   ├── spine/            # Core: cli-executor / json-handler / export / import / render / split ...
│   ├── tools/            # 70 tools (registered in registry.ts)
│   └── utils/            # Config / logger / error codes / file utilities
├── cocos-extension/      # Cocos Creator extension (panel)
├── scripts/              # Installer wizard / .ccx packaging
├── tests/                # All test suites
└── docs/                 # Specs, manuals, progress
```

## 💰 Support

Available on the [Swarms Marketplace](https://swarms.world/agent/c44211d8-0ed5-4948-8c4e-10e63f465bc3)

## 📄 License

MIT
