---
name: prg-generator
description: Generate, inspect, and reverse-compile Project Graph v2.7.0 (.prg) visual graph files from code repositories, monorepos, Markdown documents, or structured data. Includes automated codebase/dependency scanner (repo2prg), Section-aware tree & DAG layout engines (md2prg), and .prg validator/decompiler (prg-inspect).
license: MIT
compatibility: opencode
metadata:
  domain: graph-visualization
  project: project-graph
  prgVersion: "2.7.0"
---

## Purpose

This skill enables AI agents and developers to create, analyze, and manipulate `.prg` files — the native file format for [Project Graph](https://github.com/graphif/project-graph) (`v2.7.0`), a desktop node-graph tool for visual thinking, architecture design, and codebase exploration.

**This skill is 100% self-contained.** The `md2prg/` directory contains three zero-config TypeScript CLI tools:

1. **`repo2prg.ts`** — **Automated Codebase & Monorepo Scanner**: Scans source directories or workspace packages (`package.json` / `Cargo.toml`), extracts folder hierarchies into nested `Section` containers, extracts file docstrings/exports into node `details`, resolves static `import` dependencies into directed edges (`LineEdge` / `ArcEdge`), and outputs a ready-to-open `.prg` (or editable intermediate Markdown).
2. **`md2prg.ts`** — **Enhanced Markdown DSL → `.prg` Compiler**: Converts Markdown outlines with Section directives (`[section]`), semantic color tags (`#blue`, `#green`), rich node `details` (code blocks, notes), and inline or external edges into laid-out `.prg` files using either a **Section-aware Rightward Tree** (`--layout tree`) or a **Layered DAG** (`--layout dag`) algorithm.
3. **`prg-inspect.ts`** — **`.prg` Inspector, Validator & Reverse-Compiler (`prg2md`)**: Summarizes any `.prg` file, validates `v2.7.0` schema & `$` pointer integrity, or decompiles an existing `.prg` file back into Markdown DSL so AI agents can read and edit human-authored graphs.

---

## Quick Start

```bash
# Install dependencies once inside the tool directory:
cd md2prg && npm install

# 1. Scan a codebase folder (folders -> Sections, files -> nodes + import edges):
npx tsx repo2prg.ts /path/to/repo/src --mode files --layout dag -o codebase.prg

# 2. Scan a monorepo workspace (package.json / Cargo.toml dependencies):
npx tsx repo2prg.ts /path/to/monorepo --mode packages -o architecture.prg

# 3. Compile an Enhanced Markdown document into a .prg file:
npx tsx md2prg.ts architecture.md --layout dag --auto-color -o architecture.prg

# 4. Inspect or reverse-compile an existing .prg file into Markdown for AI reading:
npx tsx prg-inspect.ts summary architecture.prg
npx tsx prg-inspect.ts to-md architecture.prg -o exported.md
```

---

## Workflow 1: Analyzing a Code Repository (`repo2prg.ts`)

When asked to visualize or analyze an existing codebase or project directory, **always start with `repo2prg.ts`**.

### Mode A: File & Import Graph (`--mode files`, default)

Scans source files (`.ts`, `.tsx`, `.js`, `.py`, `.rs`, `.go`, `.java`, `.cpp`, etc.), ignores `node_modules`/`.git`/`dist`/`target`, and builds:
- **Nested `Section` containers** for directories
- **`TextNode`s** for source files, automatically populating `details` with line count, top doc-comment, and exported symbols (`export function/class/interface`, `pub fn/struct`, `def/class`)
- **Directed edges** for static imports (`./relative` and `@/alias` imports). Bidirectional imports (`A ⇄ B`) are automatically rendered as curved `ArcEdge`s (`offset: 50`) so arrows never overlap.

```bash
# Scan up to depth 3, output both .prg and editable intermediate Markdown:
npx tsx repo2prg.ts /path/to/project/src \
  --mode files \
  --max-depth 3 \
  --layout dag \
  --emit-md /tmp/review.md \
  -o /tmp/project-src.prg
```

> **Pro Tip for AI Agents**: Use `--emit-md /tmp/review.md` first! You can then read `/tmp/review.md`, add high-level architectural notes or extra cross-cutting edges, and re-compile with `npx tsx md2prg.ts /tmp/review.md --layout dag -o final.prg`.

### Mode B: Monorepo / Workspace Package Graph (`--mode packages`)

Discovers workspace packages (`package.json` / `Cargo.toml`), groups them by top-level folder (`apps/`, `packages/`, `crates/`) into `Section`s, and connects internal workspace dependencies.

```bash
npx tsx repo2prg.ts /path/to/monorepo --mode packages -o monorepo.prg
```

---

## Workflow 2: Authoring Graphs with Enhanced Markdown DSL (`md2prg.ts`)

You can author rich architecture diagrams, concept maps, call graphs, or state machines using standard Markdown headings enhanced with directives and inline edges.

### Markdown DSL Syntax Cheat Sheet

```markdown
# [section] System Architecture
This top-level description becomes the Section's rich text details.

## [section] Frontend Layer #blue

### Web App #green
Entry point: `src/main.tsx`
- React 19 + Jotai state
- Canvas 2D renderer
-> API Gateway : HTTPS / REST
~> Auth Service : OAuth2 PKCE [arc:60]

### [url:https://graphif.dev/docs] Official Docs #cyan
Click this UrlNode in Project Graph to open documentation.

## [section] Backend Services #purple

### API Gateway #orange #dashed
Handles routing and rate limiting.
<-> Auth Service : Token validation

### Auth Service
```ts
export async function verifyToken(jwt: string): Promise<Session>
```
..> Redis Cache : Session lookup
```

### Heading Directives

| Directive / Tag | Effect |
| :--- | :--- |
| `[section]` or `{section}` | Renders this heading as a visual **`Section` container** wrapping all its sub-headings |
| `[url:https://...]` | Renders this heading as a clickable **`UrlNode`** card |
| `[latex]` | Renders this heading as a **`LatexNode`** math formula |
| `#blue`, `#green`, `#red`, `#yellow`, `#purple`, `#orange`, `#cyan`, `#gray` | Sets node/Section color from the built-in semantic palette |
| `[color:#RRGGBB]` or `[color:r,g,b,a]` | Sets custom RGBA color |
| `#dashed`, `#solid`, `#none` | Sets `borderStyle` (`"solid"` \| `"dashed"` \| `"none"`) |
| `[scale:1]`, `[scale:-1]` | Sets `fontScaleLevel` (`fontSize = 32 * 2^(level/2)`) |

### Body Content → Node `details` (Rich Text AST)

Everything written in the body under a heading (paragraphs, bullet lists, fenced code blocks ```` ```ts ... ``` ````) is automatically converted into **PlateJS / Slate JSON AST (`details`)** attached to that node! When the user clicks or hovers the node in Project Graph, the full code snippet or documentation pops up.

### Inline Edge Syntax (inside node body)

You can declare non-tree edges directly inside the source node's body (or provide a separate `--edges edges.json` file):

| Syntax | Edge Class & Style | Use Case |
| :--- | :--- | :--- |
| `-> Target Node : label` | Solid `LineEdge` | Standard call / dependency / flow |
| `..> Target Node : label` | Dashed `LineEdge` (`lineType: "dashed"`) | Optional / async / weak dependency |
| `~> Target Node : label` | Curved `ArcEdge` (`offset: 60`) | Cross-layer jumps or callbacks that might cross other nodes |
| `~> Target Node : label [arc:-80]` | Curved `ArcEdge` with custom offset | Negative offset bends right; positive bends left |
| `<-> Target Node : label` | Pair of opposite `ArcEdge`s (`+50` / `-50`) | **Bidirectional relationship** without overlapping lines |

### `md2prg.ts` CLI Options

```bash
npx tsx md2prg.ts <input.md> [options]

Options:
  -o, --output <file>       Output file path (default: <input>.prg)
  --layout <tree|dag>       'tree' (rightward tree, default) or 'dag' (layered Kahn DAG)
  --section-depth <number>  Auto-convert headings with children at depth <= N into Section containers
  --auto-color              Automatically color-code top-level branches / Sections
  --edges <file>            Extra edges JSON file: [{ "from": "A", "to": "B", "text": "...", "edgeType": "arc", "offset": 60 }]
  --readme <file>           Embed a README.md file inside the .prg archive
  --gap <number>            Horizontal gap between layers / parent-child (default: 150)
  --spacing <number>        Vertical spacing between siblings (default: 24)
  --json                    Output raw stage JSON array instead of .prg zip
```

---

## Workflow 3: Inspecting & Reverse-Compiling `.prg` Files (`prg-inspect.ts`)

Use `prg-inspect.ts` to read, debug, or validate any `.prg` file:

```bash
# 1. Summary of metadata version, object counts by class, and integrity status:
npx tsx prg-inspect.ts summary diagram.prg

# 2. Strict v2.7.0 schema validation (checks positional key order, $ references, UUIDs):
npx tsx prg-inspect.ts validate diagram.prg

# 3. Decompile a .prg file back into Markdown DSL (headings + [section] + details + -> edges):
npx tsx prg-inspect.ts to-md diagram.prg -o decompiled.md
```

---

## Project Graph `v2.7.0` `.prg` File Format Specification

### 1. ZIP Container & Compression Rule

A `.prg` file is a ZIP archive containing MessagePack-encoded entries:

```
project.prg (ZIP — MUST be stored with compression level: 0)
├── stage.msgpack        # Main graph array: StageObject[]
├── tags.msgpack         # Project tag list: string[]
├── reference.msgpack    # Cross-file references: { sections: Record<string, string[]>, files: string[] }
├── metadata.msgpack     # Metadata: { version: "2.7.0", extension?: ExtensionMetadata }
├── README.md            # Optional project overview markdown
└── attachments/         # Optional binary attachments ({uuid}.png, {uuid}.svg, etc.)
```

> **CRITICAL (`level: 0`)**: Project Graph `v2.7.0` uses `@zip.js/zip.js` with `{ level: 0 }` (uncompressed store) on both `ZipWriter` and every `writer.add()` call to prevent UI freezes during save/load.

> **CRITICAL (`metadata.version`)**: Always set `metadata.version` to `"2.7.0"` (SemVer string). Do **NOT** use legacy integer strings like `"18"` — `compareProjectVersions("18", "2.1.0")` treats `"18"` as major version `18 > 2`, causing `ProjectUpgrader` to skip all `2.0.0 → 2.7.0` migrations!

---

### 2. Serializer Rules (`@graphif/serializer`)

#### Class Identifier (`_`) & Path Reference (`$`)
- Every serialized class instance has `"_"` set to its class name (`"TextNode"`, `"Section"`, `"LineEdge"`, `"ArcEdge"`, `"UrlNode"`, `"LatexNode"`, `"Vector"`, `"Color"`, `"Rectangle"`, `"CollisionBox"`, `"Line"`).
- Objects decorated with `@id` (`uuid` field on entities/associations) are deduplicated by `serialize()`. The first occurrence in traversal order is serialized as a full object; subsequent occurrences become `{"$": "/path/from/root"}`.
- **Canonical Ordering Rule for Generators**:
  Place all leaf entities (`TextNode`, `UrlNode`, `LatexNode`) first in the root `stage` array (`index 0 .. N-1`), followed by `Section` containers in bottom-up post-order (innermost child Sections before outer parent Sections), followed by edges (`LineEdge`, `ArcEdge`).
  This guarantees that every entity's first occurrence is at root path `"/i"`, so `Section.children` and `Edge.associationList` simply use `[{"$": "/i"}]`.

#### CRITICAL: Positional Key Ordering for Value Types
In `@graphif/serializer`, entity classes (`TextNode`, `Section`, `LineEdge`, etc.) have `@passObject` (they receive the JSON object as named options).
**However, geometry and value classes (`Vector`, `Color`, `Rectangle`, `Line`, `CollisionBox`) do NOT have `@passObject`!** During deserialization (`_deserialize`), their constructor arguments are collected via `for (const key in json)` — which iterates JSON keys in **insertion order**!

Therefore, JSON key order in these objects is **strictly mandatory**:
- **`Vector`**: `{"_": "Vector", "x": 100, "y": 200}` (`x` MUST precede `y`)
- **`Color`**: `{"_": "Color", "r": 56, "g": 126, "b": 177, "a": 1}` (`r`, `g`, `b`, `a` in exact order; `a: 0` means transparent / default theme color)
- **`Rectangle`**: `{"_": "Rectangle", "location": Vector, "size": Vector}` (`location` MUST precede `size`)
- **`Line`**: `{"_": "Line", "start": Vector, "end": Vector}` (`start` MUST precede `end`)
- **`CollisionBox`**: `{"_": "CollisionBox", "shapes": [...]}`

---

### 3. Stage Object Schemas (`v2.7.0`)

#### `TextNode`
```json
{
  "_": "TextNode",
  "details": [
    { "type": "p", "children": [{ "text": "Detailed notes or docstring..." }] }
  ],
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "text": "AuthService.ts",
  "collisionBox": {
    "_": "CollisionBox",
    "shapes": [
      {
        "_": "Rectangle",
        "location": { "_": "Vector", "x": -120, "y": -38 },
        "size": { "_": "Vector", "x": 280, "y": 76 }
      }
    ]
  },
  "color": { "_": "Color", "r": 56, "g": 126, "b": 177, "a": 1 },
  "fontScaleLevel": 0,
  "sizeAdjust": "auto",
  "fontFamily": "",
  "fontWeight": "",
  "borderStyle": "solid"
}
```

#### `Section` (Container / Group)
```json
{
  "_": "Section",
  "details": [],
  "uuid": "550e8400-e29b-41d4-a716-446655440001",
  "_collisionBoxNormal": {
    "_": "CollisionBox",
    "shapes": [
      { "_": "Line", "start": { "_": "Vector", "x": -200, "y": -150 }, "end": { "_": "Vector", "x": 200, "y": -150 } },
      { "_": "Line", "start": { "_": "Vector", "x": 200, "y": -150 }, "end": { "_": "Vector", "x": 200, "y": 150 } },
      { "_": "Line", "start": { "_": "Vector", "x": 200, "y": 150 }, "end": { "_": "Vector", "x": -200, "y": 150 } },
      { "_": "Line", "start": { "_": "Vector", "x": -200, "y": 150 }, "end": { "_": "Vector", "x": -200, "y": -150 } },
      { "_": "Rectangle", "location": { "_": "Vector", "x": -200, "y": -150 }, "size": { "_": "Vector", "x": 400, "y": 50 } }
    ]
  },
  "color": { "_": "Color", "r": 56, "g": 126, "b": 177, "a": 0.18 },
  "text": "src/core/",
  "children": [{ "$": "/0" }, { "$": "/1" }],
  "isCollapsed": false,
  "isHidden": false,
  "locked": false,
  "borderStyle": "solid"
}
```
- **Important**: Do **not** create `LineEdge`s between a `Section` and its own `children` — visual containment inside the Section box represents membership.

#### `UrlNode`
```json
{
  "_": "UrlNode",
  "details": [],
  "uuid": "550e8400-e29b-41d4-a716-446655440002",
  "title": "PRG Specification",
  "url": "https://graphif.dev/docs/spec/prg",
  "color": { "_": "Color", "r": 0, "g": 0, "b": 0, "a": 0 },
  "collisionBox": {
    "_": "CollisionBox",
    "shapes": [
      {
        "_": "Rectangle",
        "location": { "_": "Vector", "x": 100, "y": 100 },
        "size": { "_": "Vector", "x": 320, "y": 150 }
      }
    ]
  }
}
```

#### `LineEdge` & `ArcEdge`
```json
// Straight edge (LineEdge):
{
  "_": "LineEdge",
  "associationList": [{ "$": "/0" }, { "$": "/1" }],
  "color": { "_": "Color", "r": 0, "g": 0, "b": 0, "a": 0 },
  "targetRectangleRate": { "_": "Vector", "x": 0.01, "y": 0.5 },
  "sourceRectangleRate": { "_": "Vector", "x": 0.99, "y": 0.5 },
  "uuid": "550e8400-e29b-41d4-a716-446655440003",
  "text": "calls",
  "lineType": "solid",
  "arrowType": "default"
}

// Curved arc edge (ArcEdge — ideal for bidirectional links A ⇄ B or cross-layer jumps):
{
  "_": "ArcEdge",
  "associationList": [{ "$": "/1" }, { "$": "/0" }],
  "color": { "_": "Color", "r": 56, "g": 126, "b": 177, "a": 1 },
  "targetRectangleRate": { "_": "Vector", "x": 0.5, "y": 0.5 },
  "sourceRectangleRate": { "_": "Vector", "x": 0.5, "y": 0.5 },
  "uuid": "550e8400-e29b-41d4-a716-446655440004",
  "text": "callback",
  "lineType": "solid",
  "arrowType": "default",
  "offset": 60,
  "textPosition": 0.5
}
```
