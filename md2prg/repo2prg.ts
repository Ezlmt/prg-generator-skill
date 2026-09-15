import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildLayoutGraph } from "./md2prg.js";
import { parseMarkdownDocument, SECTION_PALETTE, SEMANTIC_COLORS } from "./markdownParse.js";
import { addExtraEdgesToStage, buildStageFromLayout, createPrgFile, type ExtraEdge } from "./prgWriter.js";
import { autoLayoutDAG, autoLayoutRightwardTree, type DAGLayoutEdge } from "./treeLayout.js";

interface Repo2PrgOptions {
  targetDir: string;
  outputPath: string;
  emitMdPath?: string;
  mode: "files" | "packages";
  maxDepth: number;
  maxFilesPerDir: number;
  layout: "tree" | "dag";
  gap: number;
  spacing: number;
}

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".nx",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  ".DS_Store",
]);

const CODE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".kt",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".vue",
  ".svelte",
]);

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: npx tsx repo2prg.ts <target-dir> [options]",
      "",
      "Options:",
      "  -o, --output <file>         Output .prg file path (default: <dir-name>.prg)",
      "  --emit-md <file>            Also write intermediate Markdown DSL file (for AI inspection/editing)",
      "  --mode <files|packages>     'files' (folders->Sections, files->nodes+imports) or 'packages' (monorepo workspaces)",
      "  --max-depth <number>        Maximum folder recursion depth (default: 3)",
      "  --max-files <number>        Max files per directory to include (default: 25)",
      "  --layout <tree|dag>         Layout mode: 'tree' or 'dag' (default: tree)",
      "  --gap <number>              Horizontal gap (default: 160)",
      "  --spacing <number>          Vertical spacing (default: 24)",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv: string[]): Repo2PrgOptions {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const targetDir = path.resolve(argv[0]);
  const dirName = path.basename(targetDir) || "repo";
  let outputPath = `${dirName}.prg`;
  let emitMdPath: string | undefined;
  let mode: "files" | "packages" = "files";
  let maxDepth = 3;
  let maxFilesPerDir = 25;
  let layout: "tree" | "dag" = "tree";
  let gap = 160;
  let spacing = 24;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      outputPath = argv[++i];
      continue;
    }
    if (arg === "--emit-md") {
      emitMdPath = argv[++i];
      continue;
    }
    if (arg === "--mode") {
      const m = argv[++i];
      if (m !== "files" && m !== "packages") throw new Error(`Invalid --mode: ${m}`);
      mode = m;
      continue;
    }
    if (arg === "--max-depth") {
      maxDepth = Number(argv[++i]);
      continue;
    }
    if (arg === "--max-files") {
      maxFilesPerDir = Number(argv[++i]);
      continue;
    }
    if (arg === "--layout") {
      const l = argv[++i];
      if (l !== "tree" && l !== "dag") throw new Error(`Invalid --layout: ${l}`);
      layout = l;
      continue;
    }
    if (arg === "--gap") {
      gap = Number(argv[++i]);
      continue;
    }
    if (arg === "--spacing") {
      spacing = Number(argv[++i]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return { targetDir, outputPath, emitMdPath, mode, maxDepth, maxFilesPerDir, layout, gap, spacing };
}

interface ScannedFileInfo {
  absPath: string;
  relPath: string;
  nodeTitle: string;
  lineCount: number;
  exports: string[];
  docComment?: string;
  rawImports: string[];
}

async function analyzeSourceFile(absPath: string, rootDir: string): Promise<ScannedFileInfo> {
  const relPath = path.relative(rootDir, absPath).replace(/\\/g, "/");
  const nodeTitle = path.basename(absPath);
  let text = "";
  try {
    text = await readFile(absPath, "utf8");
  } catch {
    return { absPath, relPath, nodeTitle, lineCount: 0, exports: [], rawImports: [] };
  }

  const lines = text.split("\n");
  const lineCount = lines.length;
  const exports: string[] = [];
  const rawImports: string[] = [];

  // Extract top doc comment if present
  let docComment: string | undefined;
  const topBlockMatch = text.match(/^\s*\/\*\*([\s\S]*?)\*\//);
  if (topBlockMatch) {
    docComment = topBlockMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
  }

  for (const line of lines.slice(0, 300)) {
    // TS/JS exports
    const tsExport = line.match(
      /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|enum)\s+([A-Za-z0-9_]+)/,
    );
    if (tsExport && !exports.includes(tsExport[1])) {
      exports.push(tsExport[1]);
    }
    // Rust pub items
    const rsPub = line.match(/^\s*pub\s+(?:async\s+)?(?:fn|struct|enum|trait|mod|type)\s+([A-Za-z0-9_]+)/);
    if (rsPub && !exports.includes(rsPub[1])) {
      exports.push(rsPub[1]);
    }
    // Python top-level def/class
    const pyDef = line.match(/^(?:def|class)\s+([A-Za-z0-9_]+)/);
    if (pyDef && !pyDef[1].startsWith("_") && !exports.includes(pyDef[1])) {
      exports.push(pyDef[1]);
    }

    // Imports (TS/JS)
    const importFrom = line.match(/(?:import|export)\s+.*?\s+from\s+["']([^"']+)["']/);
    if (importFrom) rawImports.push(importFrom[1]);
    const dynamicImport = line.match(/import\(["']([^"']+)["']\)/);
    if (dynamicImport) rawImports.push(dynamicImport[1]);
  }

  return { absPath, relPath, nodeTitle, lineCount, exports: exports.slice(0, 8), docComment, rawImports };
}

function resolveImportToRelPath(
  importerRelPath: string,
  spec: string,
  allRelPaths: Set<string>,
): string | undefined {
  let candidateBase: string | undefined;
  if (spec.startsWith(".")) {
    const dir = path.posix.dirname(importerRelPath);
    candidateBase = path.posix.normalize(path.posix.join(dir, spec));
  } else if (spec.startsWith("@/")) {
    // Common alias @/ -> src/ or app/src/
    const sub = spec.slice(2);
    for (const prefix of ["src/", "app/src/", ""]) {
      const testBase = prefix + sub;
      const found = tryMatchExtensions(testBase, allRelPaths);
      if (found) return found;
    }
    return undefined;
  } else {
    return undefined;
  }

  return tryMatchExtensions(candidateBase, allRelPaths);
}

function tryMatchExtensions(base: string, allRelPaths: Set<string>): string | undefined {
  const clean = base.replace(/\.(js|jsx|ts|tsx|mjs)$/, "");
  const candidates = [
    base,
    clean,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${clean}.js`,
    `${clean}.jsx`,
    `${clean}/index.ts`,
    `${clean}/index.tsx`,
    `${clean}/index.js`,
  ];
  for (const c of candidates) {
    if (allRelPaths.has(c)) return c;
  }
  return undefined;
}

async function generateFilesMarkdownAndEdges(
  rootDir: string,
  maxDepth: number,
  maxFilesPerDir: number,
): Promise<{ markdown: string; extraEdges: ExtraEdge[]; fileCount: number }> {
  const mdLines: string[] = [];
  const scannedFiles = new Map<string, ScannedFileInfo>(); // relPath -> info
  const usedTitles = new Map<string, number>();

  const getUniqueTitle = (baseName: string, relPath: string): string => {
    const count = usedTitles.get(baseName) ?? 0;
    usedTitles.set(baseName, count + 1);
    if (count === 0) return baseName;
    return `${baseName} (${path.posix.dirname(relPath)})`;
  };

  const rootName = path.basename(rootDir);
  mdLines.push(`# [section] ${rootName}`);
  mdLines.push(`Scanned repository root: \`${rootDir}\``);
  mdLines.push("");

  const walk = async (currentDir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    const dirs = entries
      .filter((e) => e.isDirectory() && !DEFAULT_IGNORES.has(e.name) && !e.name.startsWith("."))
      .sort((a, b) => a.name.localeCompare(b.name));

    const files = entries
      .filter((e) => e.isFile() && CODE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, maxFilesPerDir);

    const headingHashes = "#".repeat(Math.min(depth + 1, 6));

    for (const file of files) {
      const absPath = path.join(currentDir, file.name);
      const info = await analyzeSourceFile(absPath, rootDir);
      info.nodeTitle = getUniqueTitle(file.name, info.relPath);
      scannedFiles.set(info.relPath, info);

      // Color tag by file role
      let colorTag = "";
      if (/index|main|app|cli/i.test(file.name)) colorTag = " #green";
      else if (/test|spec/i.test(file.name)) colorTag = " #gray";
      else if (/type|interface|schema|model/i.test(file.name)) colorTag = " #purple";

      mdLines.push(`${headingHashes} ${info.nodeTitle}${colorTag}`);
      mdLines.push(`Path: \`${info.relPath}\` (${info.lineCount} lines)`);
      if (info.docComment) {
        mdLines.push(info.docComment);
      }
      if (info.exports.length > 0) {
        mdLines.push(`Exports: \`${info.exports.join("`, `")}\``);
      }
      mdLines.push("");
    }

    for (const dir of dirs) {
      const subDir = path.join(currentDir, dir.name);
      // Check if subdir has any code files or subdirs before emitting Section
      mdLines.push(`${headingHashes} [section] ${dir.name}`);
      mdLines.push("");
      await walk(subDir, depth + 1);
    }
  };

  await walk(rootDir, 1);

  // Resolve imports into edges
  const allRelPaths = new Set(scannedFiles.keys());
  const rawPairs = new Set<string>();
  const extraEdges: ExtraEdge[] = [];

  for (const [importerRel, info] of scannedFiles) {
    for (const spec of info.rawImports) {
      const targetRel = resolveImportToRelPath(importerRel, spec, allRelPaths);
      if (targetRel && targetRel !== importerRel) {
        const targetInfo = scannedFiles.get(targetRel);
        if (targetInfo) {
          const key = `${info.nodeTitle}|||${targetInfo.nodeTitle}`;
          if (!rawPairs.has(key)) {
            rawPairs.add(key);
          }
        }
      }
    }
  }

  // Detect bidirectional edges and use ArcEdge for them
  for (const pair of rawPairs) {
    const [from, to] = pair.split("|||");
    const reverseKey = `${to}|||${from}`;
    if (rawPairs.has(reverseKey)) {
      extraEdges.push({
        from,
        to,
        text: "imports",
        edgeType: "arc",
        offset: 50,
        color: SEMANTIC_COLORS.blue,
      });
    } else {
      extraEdges.push({
        from,
        to,
        text: "imports",
        edgeType: "line",
      });
    }
  }

  return { markdown: mdLines.join("\n"), extraEdges, fileCount: scannedFiles.size };
}

interface PackageInfo {
  name: string;
  relDir: string;
  groupDir: string;
  version: string;
  description: string;
  deps: string[];
}

async function generatePackagesMarkdownAndEdges(
  rootDir: string,
): Promise<{ markdown: string; extraEdges: ExtraEdge[]; packageCount: number }> {
  const packages: PackageInfo[] = [];

  const scanForPackages = async (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    const pkgJsonEntry = entries.find((e) => e.isFile() && e.name === "package.json");
    if (pkgJsonEntry && dir !== rootDir) {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
        if (raw.name) {
          const relDir = path.relative(rootDir, dir).replace(/\\/g, "/");
          const groupDir = relDir.includes("/") ? relDir.split("/")[0] : "root";
          const allDeps = {
            ...(raw.dependencies ?? {}),
            ...(raw.devDependencies ?? {}),
          };
          packages.push({
            name: raw.name,
            relDir,
            groupDir,
            version: raw.version ?? "0.0.0",
            description: raw.description ?? "",
            deps: Object.keys(allDeps),
          });
        }
      } catch {
        // ignore invalid package.json
      }
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !DEFAULT_IGNORES.has(entry.name) && !entry.name.startsWith(".")) {
        await scanForPackages(path.join(dir, entry.name), depth + 1);
      }
    }
  };

  await scanForPackages(rootDir, 0);

  const mdLines: string[] = [];
  const rootName = path.basename(rootDir);
  mdLines.push(`# [section] ${rootName} Monorepo`);
  mdLines.push(`Workspace root with ${packages.length} packages.`);
  mdLines.push("");

  // Group by groupDir
  const byGroup = new Map<string, PackageInfo[]>();
  for (const pkg of packages) {
    if (!byGroup.has(pkg.groupDir)) byGroup.set(pkg.groupDir, []);
    byGroup.get(pkg.groupDir)!.push(pkg);
  }

  for (const [group, pkgs] of byGroup) {
    mdLines.push(`## [section] ${group}`);
    mdLines.push("");
    for (const pkg of pkgs) {
      const color = group === "app" || group === "apps" ? " #green" : " #blue";
      mdLines.push(`### ${pkg.name}${color}`);
      mdLines.push(`Path: \`${pkg.relDir}\` | Version: \`${pkg.version}\``);
      if (pkg.description) mdLines.push(pkg.description);
      mdLines.push("");
    }
  }

  const pkgNames = new Set(packages.map((p) => p.name));
  const extraEdges: ExtraEdge[] = [];
  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      if (pkgNames.has(dep) && dep !== pkg.name) {
        extraEdges.push({
          from: pkg.name,
          to: dep,
          text: "depends on",
          edgeType: "line",
          color: SEMANTIC_COLORS.purple,
        });
      }
    }
  }

  return { markdown: mdLines.join("\n"), extraEdges, packageCount: packages.length };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const dirStat = await stat(options.targetDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`Not a directory: ${options.targetDir}`);
  }

  let markdown: string;
  let extraEdges: ExtraEdge[];
  let summaryText: string;

  if (options.mode === "packages") {
    const res = await generatePackagesMarkdownAndEdges(options.targetDir);
    markdown = res.markdown;
    extraEdges = res.extraEdges;
    summaryText = `Scanned ${res.packageCount} workspace packages and ${extraEdges.length} internal dependencies.`;
  } else {
    const res = await generateFilesMarkdownAndEdges(options.targetDir, options.maxDepth, options.maxFilesPerDir);
    markdown = res.markdown;
    extraEdges = res.extraEdges;
    summaryText = `Scanned ${res.fileCount} source files and ${extraEdges.length} import edges.`;
  }

  if (options.emitMdPath) {
    await writeFile(options.emitMdPath, markdown, "utf8");
    process.stdout.write(`Wrote intermediate Markdown to ${options.emitMdPath}\n`);
  }

  const { nodes: markdownTree, inlineEdges } = parseMarkdownDocument(markdown);
  const { rootId, nodesById } = buildLayoutGraph(markdownTree, {
    autoColor: true,
    keepSyntheticRoot: false,
  });

  if (options.layout === "dag") {
    const titleToId = new Map<string, string>();
    for (const [id, n] of nodesById) {
      if (!titleToId.has(n.text)) titleToId.set(n.text, id);
    }
    const dagEdges: DAGLayoutEdge[] = [];
    for (const e of [...inlineEdges, ...extraEdges]) {
      const fromId = titleToId.get(e.from);
      const toId = titleToId.get(e.to);
      if (fromId && toId) dagEdges.push({ fromId, toId });
    }
    autoLayoutDAG(rootId, nodesById, dagEdges, {
      horizontalGap: options.gap,
      verticalSpacing: options.spacing,
    });
  } else {
    autoLayoutRightwardTree(rootId, nodesById, {
      horizontalGap: options.gap,
      verticalSpacing: options.spacing,
    });
  }

  const stage = buildStageFromLayout(rootId, nodesById);
  if (extraEdges.length > 0) {
    addExtraEdgesToStage(stage, extraEdges);
  }

  const prgBytes = await createPrgFile(stage, {
    readme: `# ${path.basename(options.targetDir)}\n\n${summaryText}\n`,
  });

  await writeFile(options.outputPath, Buffer.from(prgBytes));
  process.stdout.write(`${summaryText}\nWrote ${options.outputPath} (${stage.length} stage objects)\n`);
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    process.stderr.write(`repo2prg error: ${error.message}\n`);
  } else {
    process.stderr.write(`repo2prg error: ${String(error)}\n`);
  }
  process.exitCode = 1;
});
