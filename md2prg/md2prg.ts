import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseMarkdownToJSON, type MarkdownNode } from "./markdownParse.js";
import { addExtraEdgesToStage, buildStageFromLayout, createPrgFile, type ExtraEdge } from "./prgWriter.js";
import { autoLayoutRightwardTree, estimateNodeSize, type LayoutNode } from "./treeLayout.js";

interface CliOptions {
  inputPath: string;
  outputPath: string;
  edgesPath: string | undefined;
  json: boolean;
  gap: number;
  spacing: number;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: npx tsx md2prg.ts <input.md> [options]",
      "",
      "Options:",
      "  -o, --output <file>   Output file path (default: input filename with .prg extension)",
      "  --json                Output JSON instead of .prg",
      "  --edges <file>        Extra edges JSON file (non-tree relationships)",
      "  --gap <number>        Horizontal gap between parent-child (default: 150)",
      "  --spacing <number>    Vertical spacing between siblings (default: 20)",
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

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0) {
    throw new Error("Missing input markdown file path");
  }

  const inputPath = argv[0];
  let outputPath: string | undefined;
  let edgesPath: string | undefined;
  let json = false;
  let gap = 150;
  let spacing = 20;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-o" || arg === "--output") {
      outputPath = argv[i + 1];
      i++;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--edges") {
      edgesPath = argv[i + 1];
      if (!edgesPath) {
        throw new Error("Missing value for option: --edges");
      }
      i++;
      continue;
    }
    if (arg === "--gap") {
      gap = parseNumberOption(arg, argv[i + 1]);
      i++;
      continue;
    }
    if (arg === "--spacing") {
      spacing = parseNumberOption(arg, argv[i + 1]);
      i++;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return {
    inputPath,
    outputPath: outputPath ?? defaultOutputPath(inputPath, json),
    edgesPath,
    json,
    gap,
    spacing,
  };
}

function buildLayoutGraph(markdownNodes: MarkdownNode[]): { rootId: string; nodesById: Map<string, LayoutNode> } {
  const rootId = randomUUID();
  const rootSize = estimateNodeSize("root");
  const nodesById = new Map<string, LayoutNode>([
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

  let yIndex = 0;

  const addNode = (markdownNode: MarkdownNode, parentId: string, depth: number): string => {
    const nodeId = randomUUID();
    const size = estimateNodeSize(markdownNode.title);

    nodesById.set(nodeId, {
      id: nodeId,
      text: markdownNode.title,
      x: depth * 50,
      y: yIndex * 100,
      width: size.width,
      height: size.height,
      children: [],
    });
    yIndex++;

    const parent = nodesById.get(parentId);
    if (!parent) {
      throw new Error(`Parent node not found while building graph: ${parentId}`);
    }
    parent.children.push(nodeId);

    for (const child of markdownNode.children) {
      addNode(child, nodeId, depth + 1);
    }

    return nodeId;
  };

  for (const markdownNode of markdownNodes) {
    addNode(markdownNode, rootId, 0);
  }

  return { rootId, nodesById };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const markdownText = await readFile(options.inputPath, "utf8");
  const markdownTree = parseMarkdownToJSON(markdownText);

  const { rootId, nodesById } = buildLayoutGraph(markdownTree);

  autoLayoutRightwardTree(rootId, nodesById, {
    horizontalGap: options.gap,
    verticalSpacing: options.spacing,
  });

  const stage = buildStageFromLayout(rootId, nodesById);

  // Add extra (non-tree) edges if provided
  if (options.edgesPath) {
    const edgesText = await readFile(options.edgesPath, "utf8");
    const extraEdges: ExtraEdge[] = JSON.parse(edgesText);
    addExtraEdgesToStage(stage, extraEdges);
  }

  await mkdir(path.dirname(options.outputPath), { recursive: true });

  if (options.json) {
    await writeFile(options.outputPath, JSON.stringify(stage, null, 2), "utf8");
  } else {
    const prg = await createPrgFile(stage);
    await writeFile(options.outputPath, Buffer.from(prg));
  }

  process.stdout.write(`Wrote ${options.outputPath}\n`);
}

run().catch((error: unknown) => {
  if (error instanceof Error) {
    process.stderr.write(`md2prg error: ${error.message}\n`);
  } else {
    process.stderr.write(`md2prg error: ${String(error)}\n`);
  }
  printUsage();
  process.exitCode = 1;
});
