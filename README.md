# prg-generator-skill

An AI Agent Skill & CLI Toolkit for generating, analyzing, and reverse-compiling **Project Graph (`v4.2+` / Schema `2.7.0`)** `.prg` files from code repositories, monorepos, Markdown documents, or structured data.

---

## 📌 Version Mapping Note (`v4.2.x` App vs. `2.7.0` File Schema)

Project Graph maintains two independent version numbers in its codebase:
- **Desktop App Release Version**: `v4.2.x` (Git tags / release builds)
- **`.prg` Data File Schema Version (`LATEST_PROJECT_VERSION`)**: `"2.7.0"` (stored inside `metadata.msgpack`)

> **Why `"2.7.0"` instead of `"18"`?**
> Legacy Project Graph 1.x used raw `.json` files with integer versions (`1` .. `18`). When the `.prg` (ZIP + MessagePack) format was introduced, the schema version reset to SemVer `"2.0.0"` and increments by `0.1.0` whenever serialized stage fields change (`2.1.0` added `lineType`, `2.4.0` added `ArcEdge`, `2.7.0` added `TextNode.borderStyle`). Writing `"18"` into `metadata.msgpack` causes `compareProjectVersions("18", "2.1.0")` to treat major version `18 > 2`, skipping all `2.0.0 → 2.7.0` data upgraders! This toolkit strictly targets **`"2.7.0"`**.

---

## ✨ Key Capabilities

1. **Automated Codebase & Monorepo Scanner (`repo2prg.ts`)**:
   - **`--mode files` (Source Code & Import Graph)**:
     - Recursively scans source directories, converting folders into nested **`Section` containers** with automatic bounding boxes.
     - Extracts file line counts, top doc comments, and exported symbols (`export function/class/interface`, `pub fn/struct`, `def/class`) directly into node **`details`** (PlateJS/Slate rich text AST) — click or hover any file node in Project Graph to inspect its API!
     - Parses static `import` statements (`./relative` and `@/alias`) into directed `LineEdge`s. Bidirectional dependencies (`A ⇄ B`) automatically use curved **`ArcEdge`s (`offset: 50`)** so arrows never overlap.
   - **`--mode packages` (Monorepo / Workspace Architecture)**:
     - Scans `package.json` / `Cargo.toml` workspaces, groups packages by folder (`apps/`, `packages/`, `crates/`) into `Section`s, and connects internal workspace dependencies.
2. **Enhanced Markdown DSL & Multi-Layout Compiler (`md2prg.ts`)**:
   - **Heading Directives**: `# [section] Module`, `# [url:https://...] Docs`, `# [latex] E=mc^2`, `# Service #blue #dashed`.
   - **Body Content → Node `details`**: Paragraph text, bullet lists, and fenced code blocks under any heading automatically become rich text `details` on that node.
   - **Inline Edge Syntax**: Declare edges right inside Markdown body lines:
     - `-> Target Node : label` (solid `LineEdge`)
     - `..> Target Node : label` (dashed `LineEdge`)
     - `~> Target Node : label [arc:60]` (curved `ArcEdge`)
     - `<-> Target Node : label` (bidirectional `ArcEdge` pair with opposite `+50` / `-50` offsets)
   - **Layout Engines**:
     - `--layout tree`: Section-aware Rightward Tree layout (with automatic multi-column grid arrangement inside large folder Sections).
     - `--layout dag`: Layered Kahn DAG layout with crossing reduction for architecture pipelines and dependency flows.
3. **`.prg` Inspector, Validator & Reverse-Compiler (`prg-inspect.ts`)**:
   - `summary`: Prints metadata version, object counts by class, Section hierarchy, and integrity status.
   - `validate`: Strict `v2.7.0` schema validator checking positional constructor key order (`Vector`, `Color`, `Rectangle`, `CollisionBox`), `$` pointer bounds, and UUID uniqueness.
   - `to-md`: Decompiles any `.prg` file (including hand-drawn graphs from the desktop app) back into Enhanced Markdown DSL so AI agents can read and collaborate on human-authored graphs.

---

## 🚀 Quick Start

```bash
cd md2prg
npm install
```

### 1. Scan a Code Repository or Monorepo (`repo2prg.ts`)

```bash
# Scan source files & static imports into a layered DAG .prg:
npx tsx repo2prg.ts /path/to/project/src --mode files --layout dag -o codebase.prg

# Scan a monorepo's workspace packages (e.g. project-graph itself):
npx tsx repo2prg.ts /path/to/monorepo --mode packages -o monorepo.prg

# Emit intermediate Markdown so an AI agent can review/annotate before compiling:
npx tsx repo2prg.ts /path/to/project/src --emit-md review.md -o codebase.prg
```

### 2. Compile Enhanced Markdown to `.prg` (`md2prg.ts`)

```bash
# Compile Markdown with DAG layout and automatic branch colors:
npx tsx md2prg.ts architecture.md --layout dag --auto-color -o architecture.prg

# Auto-convert headings (depth <= 2) into Section containers:
npx tsx md2prg.ts tree.md --section-depth 2 -o grouped.prg
```

### 3. Inspect, Validate, or Decompile `.prg` Files (`prg-inspect.ts`)

```bash
# Print summary of objects, Sections, and metadata:
npx tsx prg-inspect.ts summary architecture.prg

# Run strict v2.7.0 schema and $ reference checks:
npx tsx prg-inspect.ts validate architecture.prg

# Reverse-compile any .prg file back into Markdown DSL:
npx tsx prg-inspect.ts to-md architecture.prg -o exported.md
```

---

## 📄 License

MIT
