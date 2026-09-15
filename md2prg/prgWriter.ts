import { randomUUID } from "node:crypto";
import type { ColorRGBA, InlineEdgeSpec } from "./markdownParse.js";
import { SECTION_TITLE_BAR, type LayoutNode } from "./treeLayout.js";

export type StageObject = Record<string, unknown>;

export interface ExtraEdge {
  from: string;
  to: string;
  text?: string;
  edgeType?: "line" | "arc";
  lineType?: "solid" | "dashed";
  offset?: number;
  color?: ColorRGBA;
}

export interface CreatePrgOptions {
  version?: string;
  tags?: string[];
  readme?: string;
}

export const LATEST_PRG_VERSION = "2.7.0";

function roundToTwo(value: number): number {
  if (Number.isInteger(value)) {
    return value;
  }
  return Number.parseFloat(value.toFixed(2));
}

/**
 * Positional constructor helpers — key insertion order MUST match class constructor parameters!
 */
export function makeVector(x: number, y: number): StageObject {
  return {
    _: "Vector",
    x: roundToTwo(x),
    y: roundToTwo(y),
  };
}

export function makeColor(c?: ColorRGBA): StageObject {
  if (!c) {
    return { _: "Color", r: 0, g: 0, b: 0, a: 0 };
  }
  return {
    _: "Color",
    r: Math.round(c.r),
    g: Math.round(c.g),
    b: Math.round(c.b),
    a: roundToTwo(c.a),
  };
}

export function makeRectangle(x: number, y: number, w: number, h: number): StageObject {
  return {
    _: "Rectangle",
    location: makeVector(x, y),
    size: makeVector(w, h),
  };
}

export function makeLine(x1: number, y1: number, x2: number, y2: number): StageObject {
  return {
    _: "Line",
    start: makeVector(x1, y1),
    end: makeVector(x2, y2),
  };
}

export function makeCollisionBox(x: number, y: number, w: number, h: number): StageObject {
  return {
    _: "CollisionBox",
    shapes: [makeRectangle(x, y, w, h)],
  };
}

export function makeSectionNormalCollisionBox(x: number, y: number, w: number, h: number, hasTitle: boolean): StageObject {
  const shapes: StageObject[] = [
    makeLine(x, y, x + w, y),
    makeLine(x + w, y, x + w, y + h),
    makeLine(x + w, y + h, x, y + h),
    makeLine(x, y + h, x, y),
  ];
  if (hasTitle) {
    shapes.push(makeRectangle(x, y, w, SECTION_TITLE_BAR));
  }
  return {
    _: "CollisionBox",
    shapes,
  };
}

/**
 * Build stage objects in topological bottom-up order:
 * 1. Non-Section entities (TextNode, UrlNode, LatexNode)
 * 2. Section entities in post-order (innermost Sections first, outer Sections after)
 *    so every child reference {"$": "/idx"} in Section.children points to an index < sectionIdx.
 * 3. Tree edges (only from non-Section, non-synthetic-root parents to their children)
 */
export function buildStageFromLayout(rootId: string, nodesById: Map<string, LayoutNode>): StageObject[] {
  const leafEntities: string[] = [];
  const sectionPostOrder: string[] = [];
  const visited = new Set<string>();

  const collectDfs = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = nodesById.get(nodeId);
    if (!node) return;

    for (const childId of node.children) {
      collectDfs(childId);
    }

    if (node.text === "__synthetic_root__") {
      return;
    }

    if (node.nodeType === "section") {
      sectionPostOrder.push(nodeId);
    } else {
      leafEntities.push(nodeId);
    }
  };

  collectDfs(rootId);
  for (const [nodeId] of nodesById) {
    if (!visited.has(nodeId)) {
      collectDfs(nodeId);
    }
  }

  const orderedEntityIds = [...leafEntities, ...sectionPostOrder];
  const stage: StageObject[] = [];
  const idToStageIndex = new Map<string, number>();

  for (const nodeId of orderedEntityIds) {
    const node = nodesById.get(nodeId)!;
    const stageIndex = stage.length;
    idToStageIndex.set(nodeId, stageIndex);

    if (node.nodeType === "section") {
      const childRefs = node.children
        .map((cid) => idToStageIndex.get(cid))
        .filter((idx): idx is number => idx !== undefined)
        .map((idx) => ({ $: `/${idx}` }));

      const defaultSectionColor: ColorRGBA = node.color ?? { r: 56, g: 126, b: 177, a: 0.16 };

      stage.push({
        _: "Section",
        details: node.details ?? [],
        uuid: node.id,
        _collisionBoxNormal: makeSectionNormalCollisionBox(
          node.x,
          node.y,
          node.width,
          node.height,
          Boolean(node.text),
        ),
        color: makeColor(defaultSectionColor),
        text: node.text,
        children: childRefs,
        isCollapsed: false,
        isHidden: false,
        locked: false,
        borderStyle: node.borderStyle ?? "solid",
      });
    } else if (node.nodeType === "url") {
      stage.push({
        _: "UrlNode",
        details: node.details ?? [],
        uuid: node.id,
        title: node.text,
        url: node.url ?? "https://",
        color: makeColor(node.color),
        collisionBox: makeCollisionBox(node.x, node.y, node.width, node.height),
      });
    } else if (node.nodeType === "latex") {
      stage.push({
        _: "LatexNode",
        details: node.details ?? [],
        uuid: node.id,
        latexSource: node.text,
        collisionBox: makeCollisionBox(node.x, node.y, node.width, node.height),
        color: makeColor(node.color),
        fontScaleLevel: node.fontScaleLevel ?? 0,
      });
    } else {
      stage.push({
        _: "TextNode",
        details: node.details ?? [],
        uuid: node.id,
        text: node.text,
        collisionBox: makeCollisionBox(node.x, node.y, node.width, node.height),
        color: makeColor(node.color),
        fontScaleLevel: node.fontScaleLevel ?? 0,
        sizeAdjust: "auto",
        fontFamily: "",
        fontWeight: "",
        borderStyle: node.borderStyle ?? "solid",
      });
    }
  }

  // Tree edges (only emitted when parent is a non-Section entity and not synthetic root)
  for (const nodeId of orderedEntityIds) {
    const node = nodesById.get(nodeId)!;
    if (node.nodeType === "section" || node.text === "__synthetic_root__") {
      continue;
    }

    const sourceIndex = idToStageIndex.get(nodeId);
    if (sourceIndex === undefined) continue;

    for (const childId of node.children) {
      const targetIndex = idToStageIndex.get(childId);
      if (targetIndex === undefined) continue;

      stage.push({
        _: "LineEdge",
        associationList: [{ $: `/${sourceIndex}` }, { $: `/${targetIndex}` }],
        color: makeColor(),
        targetRectangleRate: makeVector(0.01, 0.5),
        sourceRectangleRate: makeVector(0.99, 0.5),
        uuid: randomUUID(),
        text: "",
        lineType: "solid",
        arrowType: "default",
      });
    }
  }

  // Also add any inline edges discovered during Markdown parsing
  const inlineEdges: InlineEdgeSpec[] = [];
  for (const nodeId of orderedEntityIds) {
    const node = nodesById.get(nodeId)!;
    if (node.inlineEdges && node.inlineEdges.length > 0) {
      inlineEdges.push(...node.inlineEdges);
    }
  }
  if (inlineEdges.length > 0) {
    addExtraEdgesToStage(stage, inlineEdges);
  }

  return stage;
}

/**
 * Add extra (non-tree) edges to an existing stage array.
 * Matches nodes (TextNode, Section, UrlNode, LatexNode) by their display title/text field.
 * Supports both LineEdge and ArcEdge (curved edges that avoid overlapping).
 */
export function addExtraEdgesToStage(stage: StageObject[], extraEdges: ExtraEdge[]): void {
  const titleToIndex = new Map<string, number>();
  for (let i = 0; i < stage.length; i++) {
    const obj = stage[i];
    const label =
      typeof obj.text === "string"
        ? obj.text
        : typeof obj.title === "string"
          ? obj.title
          : typeof obj.latexSource === "string"
            ? obj.latexSource
            : undefined;
    if (label && !titleToIndex.has(label)) {
      titleToIndex.set(label, i);
    }
  }

  for (const edge of extraEdges) {
    const fromIndex = titleToIndex.get(edge.from);
    const toIndex = titleToIndex.get(edge.to);

    if (fromIndex === undefined) {
      process.stderr.write(`Warning: extra edge source node not found: "${edge.from}"\n`);
      continue;
    }
    if (toIndex === undefined) {
      process.stderr.write(`Warning: extra edge target node not found: "${edge.to}"\n`);
      continue;
    }

    if (edge.edgeType === "arc" || (edge.offset !== undefined && edge.offset !== 0)) {
      stage.push({
        _: "ArcEdge",
        associationList: [{ $: `/${fromIndex}` }, { $: `/${toIndex}` }],
        color: makeColor(edge.color),
        targetRectangleRate: makeVector(0.5, 0.5),
        sourceRectangleRate: makeVector(0.5, 0.5),
        uuid: randomUUID(),
        text: edge.text ?? "",
        lineType: edge.lineType ?? "solid",
        arrowType: "default",
        offset: roundToTwo(edge.offset ?? 60),
        textPosition: 0.5,
      });
    } else {
      stage.push({
        _: "LineEdge",
        associationList: [{ $: `/${fromIndex}` }, { $: `/${toIndex}` }],
        color: makeColor(edge.color),
        targetRectangleRate: makeVector(0.5, 0.5),
        sourceRectangleRate: makeVector(0.5, 0.5),
        uuid: randomUUID(),
        text: edge.text ?? "",
        lineType: edge.lineType ?? "solid",
        arrowType: "default",
      });
    }
  }
}

export async function createPrgFile(stage: StageObject[], options: CreatePrgOptions = {}): Promise<Uint8Array> {
  let msgpack: typeof import("@msgpack/msgpack");
  let zip: typeof import("@zip.js/zip.js");

  try {
    msgpack = await import("@msgpack/msgpack");
    zip = await import("@zip.js/zip.js");
  } catch (error) {
    throw new Error(
      `Missing runtime dependencies for .prg output. Install in md2prg/: npm install. ${String(error)}`,
    );
  }

  const outputWriter = new zip.Uint8ArrayWriter();
  // Explicitly use level: 0 (store uncompressed) to match Project Graph v2.7.0 save behavior
  const writer = new zip.ZipWriter(outputWriter, { level: 0 });

  await writer.add("stage.msgpack", new zip.Uint8ArrayReader(msgpack.encode(stage)), { level: 0 });
  await writer.add("tags.msgpack", new zip.Uint8ArrayReader(msgpack.encode(options.tags ?? [])), { level: 0 });
  await writer.add(
    "reference.msgpack",
    new zip.Uint8ArrayReader(
      msgpack.encode({
        sections: {},
        files: [],
      }),
    ),
    { level: 0 },
  );
  await writer.add(
    "metadata.msgpack",
    new zip.Uint8ArrayReader(
      msgpack.encode({
        version: options.version ?? LATEST_PRG_VERSION,
      }),
    ),
    { level: 0 },
  );

  if (options.readme) {
    await writer.add("README.md", new zip.Uint8ArrayReader(new TextEncoder().encode(options.readme)), { level: 0 });
  }

  await writer.close();
  return outputWriter.getData();
}
