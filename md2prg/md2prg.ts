import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseMarkdownDocument,
  SECTION_PALETTE,
  SEMANTIC_COLORS,
  type ColorRGBA,
  type MarkdownNode,
} from "./markdownParse.js";
import { addExtraEdgesToStage, buildStageFromLayout, createPrgFile, type ExtraEdge } from "./prgWriter.js";
import {
  autoLayoutDAG,
  autoLayoutRightwardTree,
  estimateNodeSize,
  type DAGLayoutEdge,
  type LayoutNode,
} from "./treeLayout.js";

export interface CliOptions {
  inputPath: string;
  outputPath: string;
  edgesPath?: string;
  readmePath?: string;
  json: boolean;
  gap: number;
  spacing: number;
  layout: "tree" | "dag";
  sectionDepth: number;
  autoColor: boolean;
  keepSyntheticRoot: boolean;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: npx tsx md2prg.ts <input.md> [options]",
      "",
      "Options:",
      "  -o, --output <file>       Output file path (default: input filename with .prg extension)",
      "  --json                    Output stage JSON instead of .prg",
      "  --edges <file>            Extra edges JSON file (non-tree relationships)",
      "  --layout <tree|dag>       Layout engine: 'dag' (hierarchical DAG, default) or 'tree' (rightward tree)",
      "  --section-depth <number>  Auto-convert headings with children at depth <= N into Section containers (default: 0)",
      "  --auto-color              Automatically color-code top-level branches / Sections",
      "  --readme <file>           Embed a README.md file inside the .prg archive",
      "  --gap <number>            Horizontal gap between layers / sections (default: 340)",
      "  --spacing <number>        Vertical spacing between siblings (default: 180)",
      "  --keep-synthetic-root     Keep a visible synthetic 'root' node even when there is a single top-level heading",
      "",
    ].join("\n"),
  );
}

function parseNumberOption(optionName: string, value: string | undefined): number {
  if (!value) {
    throw new Error(`Missing value for option: ${optionName}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for ${optionName}: ${value}`);
  }
  return parsed;
}

function defaultOutputPath(inputPath: string, asJson: boolean): string {
  const parsedPath = path.parse(inputPath);
  const extension = asJson ? ".json" : ".prg";
  return path.join(parsedPath.dir, `${parsedPath.name}${extension}`);
}

export function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const inputPath = argv[0];
  let outputPath: string | undefined;
  let edgesPath: string | undefined;
  let readmePath: string | undefined;
  let json = false;
  let gap = 340;
  let spacing = 180;
  let layout: "tree" | "dag" = "dag";
  let sectionDepth = 0;
  let autoColor = true;
  let keepSyntheticRoot = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      outputPath = argv[++i];
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--edges") {
      edgesPath = argv[++i];
      if (!edgesPath) throw new Error("Missing value for option: --edges");
      continue;
    }
    if (arg === "--readme") {
      readmePath = argv[++i];
      if (!readmePath) throw new Error("Missing value for option: --readme");
      continue;
    }
    if (arg === "--layout") {
      const val = argv[++i];
      if (val !== "tree" && val !== "dag") {
        throw new Error(`Invalid --layout value: ${val}. Expected 'tree' or 'dag'.`);
      }
      layout = val;
      continue;
    }
    if (arg === "--section-depth") {
      sectionDepth = parseNumberOption(arg, argv[++i]);
      continue;
    }
    if (arg === "--auto-color") {
      autoColor = true;
      continue;
    }
    if (arg === "--keep-synthetic-root") {
      keepSyntheticRoot = true;
      continue;
    }
    if (arg === "--gap") {
      gap = parseNumberOption(arg, argv[++i]);
      continue;
    }
    if (arg === "--spacing") {
      spacing = parseNumberOption(arg, argv[++i]);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    inputPath,
    outputPath: outputPath ?? defaultOutputPath(inputPath, json),
    edgesPath,
    readmePath,
    json,
    gap,
    spacing,
    layout,
    sectionDepth,
    autoColor,
    keepSyntheticRoot,
  };
}

const BRANCH_COLORS: ColorRGBA[] = [
  SEMANTIC_COLORS.blue,
  SEMANTIC_COLORS.green,
  SEMANTIC_COLORS.purple,
  SEMANTIC_COLORS.orange,
  SEMANTIC_COLORS.cyan,
  SEMANTIC_COLORS.red,
];

export function buildLayoutGraph(
  markdownNodes: MarkdownNode[],
  options: { sectionDepth?: number; autoColor?: boolean; keepSyntheticRoot?: boolean } = {},
): { rootId: string; nodesById: Map<string, LayoutNode> } {
  const sectionDepth = options.sectionDepth ?? 0;
  const autoColor = options.autoColor ?? true;
  const keepSyntheticRoot = options.keepSyntheticRoot ?? false;

  const nodesById = new Map<string, LayoutNode>();
  let yIndex = 0;

  const addNode = (
    markdownNode: MarkdownNode,
    parentId: string | undefined,
    depth: number,
    branchColorIndex: number,
  ): string => {
    const nodeId = randomUUID();
    const isAutoSection = depth <= sectionDepth && markdownNode.children.length > 0;
    const nodeType = isAutoSection ? "section" : markdownNode.nodeType;

    let color = markdownNode.color;
    if (!color && autoColor) {
      if (nodeType === "section") {
        color = SECTION_PALETTE[branchColorIndex % SECTION_PALETTE.length];
      } else if (depth === 1) {
        color = BRANCH_COLORS[branchColorIndex % BRANCH_COLORS.length];
      }
    }

    const size = estimateNodeSize(markdownNode.title, markdownNode.fontScaleLevel ?? 0, nodeType);

    nodesById.set(nodeId, {
      id: nodeId,
      text: markdownNode.title,
      x: depth * 50,
      y: yIndex * 100,
      width: size.width,
      height: size.height,
      children: [],
      nodeType,
      url: markdownNode.url,
      color,
      borderStyle: markdownNode.borderStyle,
      fontScaleLevel: markdownNode.fontScaleLevel,
      details: markdownNode.details,
      inlineEdges: markdownNode.inlineEdges,
    });
    yIndex++;

    if (parentId) {
      const parent = nodesById.get(parentId);
      if (!parent) {
        throw new Error(`Parent node not found while building graph: ${parentId}`);
      }
      parent.children.push(nodeId);
    }

    for (let i = 0; i < markdownNode.children.length; i++) {
      const nextBranchIdx = depth <= 1 ? i : branchColorIndex;
      addNode(markdownNode.children[i], nodeId, depth + 1, nextBranchIdx);
    }

    return nodeId;
  };

  // Create synthetic root for the canvas
  const rootId = randomUUID();
  const rootText = keepSyntheticRoot ? "root" : "__synthetic_root__";
  const rootSize = estimateNodeSize("root");
  nodesById.set(rootId, {
    id: rootId,
    text: rootText,
    x: 0,
    y: 0,
    width: rootSize.width,
    height: rootSize.height,
    children: [],
  });

  // Top-level unwrapping: If there is a single H1 heading (# [section] Title or # Title)
  // that wraps multiple Sections or DAG nodes, DO NOT create a giant outer wrapper Section box!
  // Instead, turn the H1 into an independent Header Banner card at the top of the diagram,
  // and promote its children to direct top-level canvas units under __synthetic_root__.
  if (markdownNodes.length === 1 && !keepSyntheticRoot) {
    const topNode = markdownNodes[0];
    const hasSectionChildren = topNode.children.some((c) => c.nodeType === "section");
    const shouldUnwrapTopLevel = topNode.nodeType === "section" || hasSectionChildren;

    if (shouldUnwrapTopLevel && topNode.children.length > 0) {
      // Create a standalone Header Banner card for the H1 title & overview details
      const bannerId = randomUUID();
      const bannerScale = topNode.fontScaleLevel ?? 1;
      const bannerSize = estimateNodeSize(topNode.title, bannerScale, "text");
      nodesById.set(bannerId, {
        id: bannerId,
        text: topNode.title,
        x: 0,
        y: 0,
        width: bannerSize.width,
        height: bannerSize.height,
        children: [],
        nodeType: "text",
        color: topNode.color ?? SEMANTIC_COLORS.blue,
        borderStyle: topNode.borderStyle ?? "solid",
        fontScaleLevel: bannerScale,
        details: topNode.details,
        inlineEdges: topNode.inlineEdges,
        isHeaderBanner: true,
      });
      nodesById.get(rootId)!.children.push(bannerId);

      // Add all children directly to rootId as top-level canvas layout units
      for (let i = 0; i < topNode.children.length; i++) {
        addNode(topNode.children[i], rootId, 1, i);
      }
      return { rootId, nodesById };
    }
  }

  for (let i = 0; i < markdownNodes.length; i++) {
    addNode(markdownNodes[i], rootId, 1, i);
  }

  return { rootId, nodesById };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const markdownText = await readFile(options.inputPath, "utf8");
  const { nodes: markdownTree, inlineEdges } = parseMarkdownDocument(markdownText);

  const { rootId, nodesById } = buildLayoutGraph(markdownTree, {
    sectionDepth: options.sectionDepth,
    autoColor: options.autoColor,
    keepSyntheticRoot: options.keepSyntheticRoot,
  });

  // Load extra edges if provided
  let extraEdges: ExtraEdge[] = [];
  if (options.edgesPath) {
    const edgesText = await readFile(options.edgesPath, "utf8");
    extraEdges = JSON.parse(edgesText);
  }

  if (options.layout === "dag") {
    const titleToId = new Map<string, string>();
    for (const [id, n] of nodesById) {
      if (n.text && n.text !== "__synthetic_root__" && !titleToId.has(n.text)) {
        titleToId.set(n.text, id);
      }
    }
    const dagEdges: DAGLayoutEdge[] = [];
    for (const e of [...inlineEdges, ...extraEdges]) {
      const fromId = titleToId.get(e.from);
      const toId = titleToId.get(e.to);
      if (fromId && toId) {
        dagEdges.push({ fromId, toId, text: e.text });
      }
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

  // Ensure output directory exists
  const outDir = path.dirname(options.outputPath);
  if (outDir && outDir !== ".") {
    await mkdir(outDir, { recursive: true });
  }

  if (options.json) {
    await writeFile(options.outputPath, `${JSON.stringify(stage, null, 2)}\n`, "utf8");
    process.stdout.write(`Wrote ${options.outputPath} (${stage.length} stage objects)\n`);
    return;
  }

  let readmeContent: string | undefined;
  if (options.readmePath) {
    readmeContent = await readFile(options.readmePath, "utf8");
  }

  const prgBytes = await createPrgFile(stage, {
    readme: readmeContent,
  });
  await writeFile(options.outputPath, Buffer.from(prgBytes));
  process.stdout.write(`Wrote ${options.outputPath} (${stage.length} stage objects)\n`);
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    process.stderr.write(`md2prg error: ${error.message}\n`);
  } else {
    process.stderr.write(`md2prg error: ${String(error)}\n`);
  }
  process.exitCode = 1;
});
