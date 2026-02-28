---
name: prg-generator
description: Generate Project Graph .prg files from code repositories, articles, or any structured data. Uses a two-phase approach (tree layout + extra edges) for high-quality automatic layout. Use this skill whenever you need to create, inspect, or manipulate .prg files for the Project Graph desktop application.
license: MIT
compatibility: opencode
metadata:
  domain: graph-visualization
  project: project-graph
---

## Purpose

This skill enables you to generate `.prg` files — the native file format for [Project Graph](https://github.com/graphif/project-graph), a desktop application for visual project graphs.

**This skill is fully self-contained.** The `md2prg/` subdirectory inside this skill contains a complete CLI tool for converting Markdown → `.prg`. To share this skill, just copy the entire `prg-generator/` directory — no external dependencies needed beyond `npm install`.

Common use cases:

- **Code repository analysis**: Convert folder/file/function/call structures into visual graphs
- **Article/document parsing**: Extract concept relationships and render as graphs
- **Dependency visualization**: Show package, module, or API dependencies
- **Any structured data**: Convert hierarchical or relational data into `.prg` graphs

## Quick Start

```bash
# From this skill directory (where SKILL.md lives):
cd md2prg && npm install

# Convert Markdown to .prg
npx tsx md2prg.ts input.md -o output.prg

# With extra edges
npx tsx md2prg.ts input.md --edges edges.json -o output.prg
```

## Architecture: Two-Phase Pipeline

Converting **any** data source to a well-laid-out `.prg` uses a three-step process:

```
Source Data (code, docs, APIs, etc.)
    │
    ▼
Step 1: Extract structure
    ├── tree.md       ← Tree skeleton (Markdown headings)
    └── edges.json    ← Extra non-tree edges
    │
    ▼
Step 2: Layout
    tree.md → autoLayoutRightwardTree → positioned nodes (JSON)
    │
    ▼
Step 3: Merge & Package
    positioned JSON + edges.json → .prg file
```

### Why This Approach?

- **Tree layout is predictable**: The rightward tree layout always produces clean, readable results
- **Extra edges are free**: Non-tree edges are added on top without disturbing the layout
- **Markdown is universal**: Any AI can generate Markdown headings — no complex graph DSL needed
- **Handles cycles and multi-parent**: Non-tree edges can point anywhere, creating cycles or DAGs

### Step 1: Extract a Spanning Tree + Extra Edges

Given any source data, you must decompose it into:

**a) `tree.md`** — A Markdown file where heading levels (`#`, `##`, `###`, ...) define parent-child relationships:

```markdown
# Main Module

## Sub Module A

### Component 1

### Component 2

## Sub Module B

### Component 3
```

A synthetic "root" node is automatically created as parent of all `#` headings.

**Spanning tree extraction strategies** (choose based on source):

| Source Type      | Strategy                                             |
| ---------------- | ---------------------------------------------------- |
| File/folder tree | Direct mapping: folders → headings, nesting → levels |
| Call graph       | BFS from entry point, first-visit parent wins        |
| Dependency graph | Reverse-dependency tree from leaf packages           |
| Concept map      | Choose the most central concept as root, BFS outward |
| Class hierarchy  | Inheritance tree (base → derived)                    |

**b) `edges.json`** — An array of extra edges NOT in the spanning tree:

```json
[
  { "from": "Component 1", "to": "Component 3", "text": "calls" },
  { "from": "Sub Module B", "to": "Sub Module A", "text": "depends on" }
]
```

- `from` / `to`: Must match the **exact text** of a node (heading title) in `tree.md`
- `text`: Optional edge label
- These edges use center-to-center connection points (visually distinct from tree edges)

### Step 2 & 3: Layout and Package

Use the CLI tool in the `md2prg/` subdirectory of this skill:

```bash
# Install deps (first time only, from this skill directory)
cd md2prg && npm install

# Tree only → .prg
npx tsx md2prg.ts tree.md -o output.prg

# Tree + extra edges → .prg
npx tsx md2prg.ts tree.md --edges edges.json -o output.prg

# Output JSON (for debugging)
npx tsx md2prg.ts tree.md --edges edges.json -o output.json --json

# Custom spacing
npx tsx md2prg.ts tree.md --gap 200 --spacing 30 -o output.prg
```

Options:

- `-o, --output <file>`: Output path (default: input name + .prg)
- `--json`: Output stage JSON instead of .prg
- `--edges <file>`: Extra edges JSON file
- `--gap <number>`: Horizontal gap between parent-child (default: 150)
- `--spacing <number>`: Vertical spacing between siblings (default: 20)

## .prg File Format Specification

### File Structure

A `.prg` file is a **ZIP archive** containing:

```
project.prg (ZIP)
├── stage.msgpack        # Main graph data (nodes, edges, Sections)
├── tags.msgpack         # Tag list: string[]
├── reference.msgpack    # Reference relationships
├── metadata.msgpack     # Metadata (version number, etc.)
└── attachments/         # Attachment folder (images, etc.)
    ├── {uuid}.png
    └── {uuid}.jpg
```

| File                | Format                         | Description                                                   |
| ------------------- | ------------------------------ | ------------------------------------------------------------- |
| `stage.msgpack`     | MessagePack-encoded JSON array | All graphical objects (nodes, edges, Sections)                |
| `tags.msgpack`      | MessagePack-encoded string[]   | Project tag list                                              |
| `reference.msgpack` | MessagePack-encoded object     | `{ sections: Record<string, string[]>, files: string[] }`     |
| `metadata.msgpack`  | MessagePack-encoded object     | `{ version: string, createdAt?: string, updatedAt?: string }` |

### Metadata

```json
{
  "version": "18",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "updatedAt": "2024-01-02T00:00:00.000Z"
}
```

Current file version: **18**. Always use `"18"` for the version field.

### Serialization Rules

#### Class Identifier `_`

Every serialized object has a `_` field identifying its class name:

```json
{ "_": "TextNode", "uuid": "...", ... }
{ "_": "Section", "uuid": "...", ... }
{ "_": "LineEdge", "uuid": "...", ... }
```

#### Path Reference `$`

To avoid circular references and duplicate data, use `$` for path references. Paths are slash-separated indices relative to the root stage array:

```json
// If stage array is [TextNode_A, TextNode_B, Section_C, LineEdge_D]
// LineEdge_D connects A → B:
{
  "_": "LineEdge",
  "associationList": [{ "$": "/0" }, { "$": "/1" }]
}
```

**CRITICAL**: The `$` path index refers to the position of the object in the root `stage` array.

#### Numeric Precision

Float values are serialized with 2 decimal places.

### Core Data Types

#### Vector (2D vector)

```json
{ "_": "Vector", "x": 100.5, "y": 200.3 }
```

#### Color (RGBA)

```json
{ "_": "Color", "r": 255, "g": 200, "b": 100, "a": 1 }
```

Use `a: 0` for default color (the app will apply its theme color).

#### Rectangle

```json
{
  "_": "Rectangle",
  "location": { "_": "Vector", "x": 100, "y": 200 },
  "size": { "_": "Vector", "x": 150, "y": 50 }
}
```

`location` is the top-left corner. `size.x` = width, `size.y` = height.

#### CollisionBox

```json
{
  "_": "CollisionBox",
  "shapes": [
    { "_": "Rectangle", "location": {...}, "size": {...} }
  ]
}
```

### TextNode (Text Node)

```json
{
  "_": "TextNode",
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "text": "functionName()",
  "collisionBox": {
    "_": "CollisionBox",
    "shapes": [
      {
        "_": "Rectangle",
        "location": { "_": "Vector", "x": 100, "y": 200 },
        "size": { "_": "Vector", "x": 150, "y": 76 }
      }
    ]
  },
  "color": { "_": "Color", "r": 0, "g": 0, "b": 0, "a": 0 },
  "fontScaleLevel": 0,
  "sizeAdjust": "auto"
}
```

| Field            | Type                   | Description                                           |
| ---------------- | ---------------------- | ----------------------------------------------------- |
| `uuid`           | string                 | Unique ID, use `crypto.randomUUID()`                  |
| `text`           | string                 | Display text                                          |
| `collisionBox`   | CollisionBox           | Position and size                                     |
| `color`          | Color                  | Background color; `a=0` means use default theme color |
| `fontScaleLevel` | number                 | Font scale: 0=default, formula: `fontSize * 2^level`  |
| `sizeAdjust`     | `"auto"` \| `"manual"` | Size adjustment mode                                  |

### Section (Container/Group)

```json
{
  "_": "Section",
  "uuid": "550e8400-e29b-41d4-a716-446655440001",
  "text": "src/core/",
  "collisionBox": {
    "_": "CollisionBox",
    "shapes": [
      {
        "_": "Rectangle",
        "location": { "_": "Vector", "x": 50, "y": 50 },
        "size": { "_": "Vector", "x": 500, "y": 400 }
      }
    ]
  },
  "color": { "_": "Color", "r": 100, "g": 150, "b": 200, "a": 0.3 },
  "children": [{ "$": "/0" }, { "$": "/1" }],
  "isCollapsed": false,
  "locked": false
}
```

### LineEdge (Connection/Arrow)

```json
{
  "_": "LineEdge",
  "uuid": "550e8400-e29b-41d4-a716-446655440002",
  "text": "calls",
  "color": { "_": "Color", "r": 0, "g": 0, "b": 0, "a": 0 },
  "lineType": "solid",
  "associationList": [{ "$": "/0" }, { "$": "/3" }],
  "sourceRectangleRate": { "_": "Vector", "x": 0.99, "y": 0.5 },
  "targetRectangleRate": { "_": "Vector", "x": 0.5, "y": 0.5 }
}
```

| Field                 | Type                     | Description                                   |
| --------------------- | ------------------------ | --------------------------------------------- |
| `uuid`                | string                   | Unique ID                                     |
| `text`                | string                   | Label text                                    |
| `color`               | Color                    | Line color; `a=0` means use default           |
| `lineType`            | `"solid"` \| `"dashed"`  | Line style                                    |
| `associationList`     | [source_ref, target_ref] | `[0]`=source, `[1]`=target                    |
| `sourceRectangleRate` | Vector                   | Start point relative position on source (0~1) |
| `targetRectangleRate` | Vector                   | End point relative position on target (0~1)   |

**Edge direction conventions:**

- **Tree edges** (parent→child): `source=(0.99, 0.5)`, `target=(0.01, 0.5)` — right side to left side
- **Extra edges** (non-tree): `source=(0.5, 0.5)`, `target=(0.5, 0.5)` — center to center

### Coordinate System

- Origin (0, 0) at canvas center
- X axis: right is positive
- Y axis: down is positive
- Unit: pixels

## Node Size Estimation

The app auto-sizes nodes based on text content. To match:

```
FONT_SIZE = 32px
LINE_HEIGHT = 1.5
NODE_PADDING = 14px

width  = maxLineTextWidth + NODE_PADDING * 2
height = lineCount * FONT_SIZE * LINE_HEIGHT + NODE_PADDING * 2

Character width approximation (at 32px font):
  - English/ASCII: ~17.6px (FONT_SIZE * 0.55)
  - CJK/fullwidth:  ~32px  (FONT_SIZE * 1.0)

Minimum: width=100, height=76
```

## Instructions for Agents

### Standard Workflow

When asked to generate a `.prg` file, follow these steps:

#### 1. Analyze the Source

Understand the structure of the input data:

- **Code repository**: Walk the file tree, parse imports/exports, extract function signatures
- **Article/document**: Extract key concepts and their relationships
- **API documentation**: Extract endpoints, models, and their connections
- **Any graph-like data**: Identify nodes and edges

#### 2. Decompose into Tree + Extra Edges

**This is the critical step.** You must split the graph into:

**a) A spanning tree** — Write as Markdown:

- Choose the most natural hierarchy as the tree backbone
- Use `#` heading levels for depth (max 6 levels)
- Each heading becomes a TextNode
- Heading text = node display text

**b) Extra edges** — Write as JSON array:

- All edges NOT in the spanning tree
- Reference nodes by their exact heading text
- Add meaningful labels via `text` field

**Spanning tree selection tips:**

- Prefer the hierarchy that humans would naturally read (e.g., folder structure for code)
- BFS from the most important/central node gives good results
- When in doubt, pick the tree that minimizes the number of extra edges

#### 3. Generate the .prg File

Write the `tree.md` and `edges.json` files, then run:

```bash
npx tsx md2prg.ts tree.md --edges edges.json -o output.prg
```

Working directory: the `md2prg/` subdirectory of this skill (ensure `npm install` has been run).

If the tool is not available or deps are not installed, you can generate the stage JSON programmatically using the code below.

### Programmatic Generation (without CLI)

If you need to generate `.prg` files without the CLI tool, use this self-contained TypeScript code:

```typescript
import { randomUUID } from "node:crypto";

// ============ Types ============

interface MarkdownNode {
  title: string;
  content: string;
  children: MarkdownNode[];
}

interface LayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: string[];
}

interface ExtraEdge {
  from: string;
  to: string;
  text?: string;
}

type StageObject = Record<string, unknown>;

// ============ Markdown Parser ============

function parseMarkdownToJSON(markdown: string): MarkdownNode[] {
  const lines = markdown.split("\n");
  const root: MarkdownNode[] = [];
  const stack: { node: MarkdownNode; level: number }[] = [];

  for (const line of lines) {
    const titleMatch = line.match(/^(#+)\s*(.*)/);
    if (titleMatch) {
      const level = titleMatch[1].length;
      const title = titleMatch[2].trim();
      const newNode: MarkdownNode = { title, content: "", children: [] };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        root.push(newNode);
      } else {
        stack[stack.length - 1].node.children.push(newNode);
      }

      stack.push({ node: newNode, level });
    } else if (line.trim()) {
      if (stack.length > 0) {
        const current = stack[stack.length - 1].node;
        current.content += line + "\n";
        current.content = current.content.trim();
      }
    }
  }

  return root;
}

// ============ Node Size Estimation ============

function estimateNodeSize(text: string): { width: number; height: number } {
  const FONT_SIZE = 32;
  const LINE_HEIGHT = 1.5;
  const NODE_PADDING = 14;

  const lines = text.split("\n");
  let maxLineWidth = 0;

  for (const line of lines) {
    let lineWidth = 0;
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      const isWide =
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0x3000 && code <= 0x303f) ||
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0xff00 && code <= 0xffef) ||
        (code >= 0xac00 && code <= 0xd7af) ||
        (code >= 0xf900 && code <= 0xfaff);
      lineWidth += isWide ? FONT_SIZE : FONT_SIZE * 0.55;
    }
    maxLineWidth = Math.max(maxLineWidth, lineWidth);
  }

  return {
    width: Math.max(Math.round(maxLineWidth + NODE_PADDING * 2), 100),
    height: Math.max(Math.round(lines.length * FONT_SIZE * LINE_HEIGHT + NODE_PADDING * 2), 76),
  };
}

// ============ Tree Layout Algorithm ============
// Extracted from autoLayoutFastTreeMode in the Project Graph app

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function mergeRects(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = rects[0].x,
    minY = rects[0].y;
  let maxX = rects[0].x + rects[0].width,
    maxY = rects[0].y + rects[0].height;
  for (let i = 1; i < rects.length; i++) {
    minX = Math.min(minX, rects[i].x);
    minY = Math.min(minY, rects[i].y);
    maxX = Math.max(maxX, rects[i].x + rects[i].width);
    maxY = Math.max(maxY, rects[i].y + rects[i].height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function moveSubtree(id: string, dx: number, dy: number, nodes: Map<string, LayoutNode>): void {
  const n = nodes.get(id)!;
  n.x += dx;
  n.y += dy;
  for (const c of n.children) moveSubtree(c, dx, dy, nodes);
}

function treeBounds(id: string, nodes: Map<string, LayoutNode>): Rect {
  const n = nodes.get(id)!;
  return mergeRects([
    { x: n.x, y: n.y, width: n.width, height: n.height },
    ...n.children.map((c) => treeBounds(c, nodes)),
  ]);
}

function alignSiblings(childIds: string[], nodes: Map<string, LayoutNode>, gap = 20): void {
  if (childIds.length <= 1) return;
  const sorted = [...childIds].sort((a, b) => nodes.get(a)!.y - nodes.get(b)!.y);
  const first = treeBounds(sorted[0], nodes);
  let curY = first.y + first.height + gap;
  for (let i = 1; i < sorted.length; i++) {
    const r = treeBounds(sorted[i], nodes);
    const dx = first.x - r.x,
      dy = curY - r.y;
    moveSubtree(sorted[i], dx, dy, nodes);
    curY += r.height + gap;
  }
}

function placeChildrenRight(parentId: string, childIds: string[], nodes: Map<string, LayoutNode>, gap = 150): void {
  if (childIds.length === 0) return;
  const p = nodes.get(parentId)!;
  const childRects = childIds.map((c) => treeBounds(c, nodes));
  const merged = mergeRects(childRects);
  const targetCX = p.x + p.width + gap + merged.width / 2;
  const dx = targetCX - (merged.x + merged.width / 2);
  const dy = p.y + p.height / 2 - (merged.y + merged.height / 2);
  for (const c of childIds) moveSubtree(c, dx, dy, nodes);
}

function autoLayoutRightwardTree(rootId: string, nodes: Map<string, LayoutNode>, hGap = 150, vGap = 20): void {
  const root = nodes.get(rootId)!;
  const origX = root.x,
    origY = root.y;

  const dfs = (id: string) => {
    const n = nodes.get(id)!;
    for (const c of n.children) dfs(c);
    alignSiblings(n.children, nodes, vGap);
    placeChildrenRight(id, n.children, nodes, hGap);
  };

  dfs(rootId);
  const after = nodes.get(rootId)!;
  moveSubtree(rootId, origX - after.x, origY - after.y, nodes);
}

// ============ Build Layout Graph from Markdown ============

function buildLayoutGraph(mdNodes: MarkdownNode[]): { rootId: string; nodes: Map<string, LayoutNode> } {
  const rootId = randomUUID();
  const rootSize = estimateNodeSize("root");
  const nodes = new Map<string, LayoutNode>([
    [
      rootId,
      {
        id: rootId,
        text: "root",
        x: 0,
        y: 0,
        width: rootSize.width,
        height: rootSize.height,
        children: [],
      },
    ],
  ]);

  let yIdx = 0;
  const add = (md: MarkdownNode, parentId: string, depth: number) => {
    const id = randomUUID();
    const size = estimateNodeSize(md.title);
    nodes.set(id, {
      id,
      text: md.title,
      x: depth * 50,
      y: yIdx * 100,
      width: size.width,
      height: size.height,
      children: [],
    });
    yIdx++;
    nodes.get(parentId)!.children.push(id);
    for (const child of md.children) add(child, id, depth + 1);
  };

  for (const md of mdNodes) add(md, rootId, 0);
  return { rootId, nodes };
}

// ============ Stage JSON Builder ============

function roundToTwo(v: number): number {
  return Number.isInteger(v) ? v : Number.parseFloat(v.toFixed(2));
}

function buildStage(rootId: string, nodes: Map<string, LayoutNode>, extraEdges: ExtraEdge[] = []): StageObject[] {
  // DFS order for node indices
  const ordered: string[] = [];
  const visited = new Set<string>();
  const dfs = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    ordered.push(id);
    for (const c of nodes.get(id)!.children) dfs(c);
  };
  dfs(rootId);
  for (const [id] of nodes) if (!visited.has(id)) dfs(id);

  const stage: StageObject[] = [];
  const idToIdx = new Map<string, number>();

  // TextNodes
  for (const id of ordered) {
    const n = nodes.get(id)!;
    idToIdx.set(id, stage.length);
    stage.push({
      _: "TextNode",
      uuid: n.id,
      text: n.text,
      collisionBox: {
        _: "CollisionBox",
        shapes: [
          {
            _: "Rectangle",
            location: { _: "Vector", x: roundToTwo(n.x), y: roundToTwo(n.y) },
            size: { _: "Vector", x: roundToTwo(n.width), y: roundToTwo(n.height) },
          },
        ],
      },
      color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
      fontScaleLevel: 0,
      sizeAdjust: "auto",
    });
  }

  // Tree edges (right-to-left direction)
  for (const id of ordered) {
    const n = nodes.get(id)!;
    const srcIdx = idToIdx.get(id)!;
    for (const childId of n.children) {
      const tgtIdx = idToIdx.get(childId)!;
      stage.push({
        _: "LineEdge",
        uuid: randomUUID(),
        text: "",
        color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
        lineType: "solid",
        associationList: [{ $: `/${srcIdx}` }, { $: `/${tgtIdx}` }],
        sourceRectangleRate: { _: "Vector", x: 0.99, y: 0.5 },
        targetRectangleRate: { _: "Vector", x: 0.01, y: 0.5 },
      });
    }
  }

  // Extra edges (center-to-center direction)
  const titleToIdx = new Map<string, number>();
  for (let i = 0; i < stage.length; i++) {
    const obj = stage[i];
    if (obj._ === "TextNode" && typeof obj.text === "string" && !titleToIdx.has(obj.text)) {
      titleToIdx.set(obj.text, i);
    }
  }
  for (const edge of extraEdges) {
    const fromIdx = titleToIdx.get(edge.from);
    const toIdx = titleToIdx.get(edge.to);
    if (fromIdx === undefined || toIdx === undefined) continue;
    stage.push({
      _: "LineEdge",
      uuid: randomUUID(),
      text: edge.text ?? "",
      color: { _: "Color", r: 0, g: 0, b: 0, a: 0 },
      lineType: "solid",
      associationList: [{ $: `/${fromIdx}` }, { $: `/${toIdx}` }],
      sourceRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
      targetRectangleRate: { _: "Vector", x: 0.5, y: 0.5 },
    });
  }

  return stage;
}

// ============ .prg File Packaging ============

async function createPrgFile(stage: StageObject[]): Promise<Uint8Array> {
  const { encode } = await import("@msgpack/msgpack");
  const { ZipWriter, Uint8ArrayWriter, Uint8ArrayReader } = await import("@zip.js/zip.js");

  const uwriter = new Uint8ArrayWriter();
  const writer = new ZipWriter(uwriter);
  await writer.add("stage.msgpack", new Uint8ArrayReader(encode(stage)));
  await writer.add("tags.msgpack", new Uint8ArrayReader(encode([])));
  await writer.add("reference.msgpack", new Uint8ArrayReader(encode({ sections: {}, files: [] })));
  await writer.add("metadata.msgpack", new Uint8ArrayReader(encode({ version: "18" })));
  await writer.close();
  return uwriter.getData();
}

// ============ Full Pipeline ============

async function markdownToPrg(
  markdown: string,
  extraEdges: ExtraEdge[] = [],
  options: { hGap?: number; vGap?: number } = {},
): Promise<Uint8Array> {
  const mdTree = parseMarkdownToJSON(markdown);
  const { rootId, nodes } = buildLayoutGraph(mdTree);
  autoLayoutRightwardTree(rootId, nodes, options.hGap ?? 150, options.vGap ?? 20);
  const stage = buildStage(rootId, nodes, extraEdges);
  return createPrgFile(stage);
}
```

### Important Rules

1. **UUIDs**: Always use `crypto.randomUUID()` for all uuid fields
2. **Path references**: `$` indices MUST match actual positions in the stage array
3. **Color `a: 0`**: Use transparent alpha for default theming
4. **Version**: Always use `"18"` in metadata
5. **Edge direction**: Tree edges use `(0.99, 0.5) → (0.01, 0.5)`, extra edges use `(0.5, 0.5) → (0.5, 0.5)`
6. **Coordinate origin**: (0,0) is canvas center — layout around origin for best initial view
7. **Node text matching**: Extra edges reference nodes by their exact display text. If two nodes share the same text, the first one (in DFS order) is used.
8. **Minimum node size**: width=100, height=76 (matches app rendering)

### Example: Full Pipeline

Source: A small web app architecture

**Step 1: tree.md**

```markdown
# Web App

## Frontend

### React Components

### State Management

### API Client

## Backend

### Express Server

### Database

#### PostgreSQL

#### Redis

### Auth Service
```

**Step 1: edges.json**

```json
[
  { "from": "API Client", "to": "Express Server", "text": "HTTP requests" },
  { "from": "Auth Service", "to": "State Management", "text": "JWT tokens" },
  { "from": "Redis", "to": "Auth Service", "text": "session cache" }
]
```

**Step 2 & 3: Generate**

```bash
cd md2prg  # inside this skill directory
npx tsx md2prg.ts tree.md --edges edges.json -o webapp.prg
```

Result: A `.prg` file with a clean rightward tree layout, plus three extra cross-links shown as center-to-center connections.
