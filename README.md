# prg-generator-skill

[English](#english) | [中文](#中文)

---

## English

An [OpenCode](https://opencode.ai) skill + standalone CLI tool for generating [Project Graph](https://github.com/graphif/project-graph) `.prg` files from Markdown.

**Converts any structured data → well-laid-out `.prg` graph files**, without opening the desktop app.

### Features

- **Two-phase pipeline**: Markdown (tree structure) + extra edges JSON → auto-layout → `.prg`
- **Rightward tree layout**: Matches the app's built-in `autoLayoutFastTreeMode` algorithm
- **Node sizing**: CJK-aware text measurement matching the app's rendering (FONT_SIZE=32, NODE_PADDING=14)
- **Extra edges**: Non-tree relationships overlaid on the tree layout with center-to-center connections
- **Self-contained**: No dependency on the Project Graph app or its monorepo packages
- **Dual use**: Works as an OpenCode AI skill AND as a standalone CLI tool

### Quick Start (CLI)

```bash
cd md2prg
npm install

# Markdown → .prg
npx tsx md2prg.ts input.md -o output.prg

# With extra edges
npx tsx md2prg.ts input.md --edges edges.json -o output.prg

# Output JSON for debugging
npx tsx md2prg.ts input.md --json -o output.json
```

### CLI Options

| Option                | Description                         | Default       |
| --------------------- | ----------------------------------- | ------------- |
| `-o, --output <file>` | Output file path                    | `<input>.prg` |
| `--json`              | Output stage JSON instead of `.prg` | off           |
| `--edges <file>`      | Extra edges JSON file               | none          |
| `--gap <number>`      | Horizontal gap (parent→child)       | 150           |
| `--spacing <number>`  | Vertical spacing (siblings)         | 20            |

### Input Format

**tree.md** — Heading levels define parent-child relationships:

```markdown
# Main Module

## Sub Module A

### Component 1

### Component 2

## Sub Module B

### Component 3
```

**edges.json** (optional) — Non-tree relationships:

```json
[
  { "from": "Component 1", "to": "Component 3", "text": "calls" },
  { "from": "Sub Module B", "to": "Sub Module A", "text": "depends on" }
]
```

### Use as OpenCode Skill

Copy this entire repository into your project's `.opencode/skills/prg-generator/` directory:

```
.opencode/skills/prg-generator/
├── SKILL.md
└── md2prg/
    ├── md2prg.ts
    ├── markdownParse.ts
    ├── treeLayout.ts
    ├── prgWriter.ts
    ├── package.json
    ├── tsconfig.json
    └── types.d.ts
```

The AI agent will then be able to generate `.prg` files directly. See `SKILL.md` for the full specification including the `.prg` format, serialization rules, and programmatic generation code.

### Project Structure

```
.
├── SKILL.md          # OpenCode skill definition (full .prg spec + embedded code)
├── README.md
└── md2prg/           # Standalone CLI tool
    ├── md2prg.ts     # CLI entry point
    ├── markdownParse.ts  # Markdown → tree parser
    ├── treeLayout.ts     # Rightward tree layout algorithm
    ├── prgWriter.ts      # Stage builder + .prg packager (msgpack + ZIP)
    ├── package.json
    ├── tsconfig.json
    └── types.d.ts
```

### License

MIT

---

## 中文

一个 [OpenCode](https://opencode.ai) skill + 独立命令行工具，用于从 Markdown 生成 [Project Graph](https://github.com/graphif/project-graph) 的 `.prg` 文件。

**将任何结构化数据 → 排版美观的 `.prg` 图文件**，无需打开桌面应用。

### 特性

- **两阶段管线**：Markdown（树结构）+ 额外边 JSON → 自动布局 → `.prg`
- **右向树布局**：与应用内置的 `autoLayoutFastTreeMode` 算法一致
- **节点尺寸**：CJK 感知的文字测量，匹配应用渲染参数（FONT_SIZE=32, NODE_PADDING=14）
- **额外边**：非树关系以中心到中心连线叠加在树布局之上
- **完全独立**：不依赖 Project Graph 应用或其 monorepo 包
- **双重用途**：既是 OpenCode AI skill，也是独立 CLI 工具

### 快速开始（命令行）

```bash
cd md2prg
npm install

# Markdown → .prg
npx tsx md2prg.ts input.md -o output.prg

# 带额外边
npx tsx md2prg.ts input.md --edges edges.json -o output.prg

# 输出 JSON 用于调试
npx tsx md2prg.ts input.md --json -o output.json
```

### 命令行参数

| 参数                  | 说明                  | 默认值             |
| --------------------- | --------------------- | ------------------ |
| `-o, --output <file>` | 输出文件路径          | `<输入文件名>.prg` |
| `--json`              | 输出 JSON 而非 `.prg` | 关闭               |
| `--edges <file>`      | 额外边 JSON 文件      | 无                 |
| `--gap <number>`      | 父子节点水平间距      | 150                |
| `--spacing <number>`  | 兄弟节点垂直间距      | 20                 |

### 输入格式

**tree.md** — 标题层级定义父子关系：

```markdown
# 主模块

## 子模块 A

### 组件 1

### 组件 2

## 子模块 B

### 组件 3
```

**edges.json**（可选）— 非树关系：

```json
[
  { "from": "组件 1", "to": "组件 3", "text": "调用" },
  { "from": "子模块 B", "to": "子模块 A", "text": "依赖" }
]
```

### 作为 OpenCode Skill 使用

将整个仓库复制到项目的 `.opencode/skills/prg-generator/` 目录下即可：

```
.opencode/skills/prg-generator/
├── SKILL.md
└── md2prg/
    ├── md2prg.ts
    ├── markdownParse.ts
    ├── treeLayout.ts
    ├── prgWriter.ts
    ├── package.json
    ├── tsconfig.json
    └── types.d.ts
```

AI agent 就能直接生成 `.prg` 文件了。完整的 `.prg` 格式规范、序列化规则和编程式生成代码见 `SKILL.md`。

### 许可证

MIT
