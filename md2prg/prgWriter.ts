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

interface BoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
  isSection?: boolean;
  childrenIndices?: Set<number>;
}

function getStageEntityRect(obj: StageObject): BoxRect | null {
  if (obj._ === "TextNode" || obj._ === "UrlNode" || obj._ === "LatexNode") {
    const cbox = obj.collisionBox as { shapes?: { location?: { x: number; y: number }; size?: { x: number; y: number } }[] };
    const r = cbox?.shapes?.[0];
    if (r?.location && r?.size) {
      return { x: r.location.x, y: r.location.y, width: r.size.x, height: r.size.y, isSection: false };
    }
  } else if (obj._ === "Section") {
    const cbox = obj._collisionBoxNormal as {
      shapes?: { start?: { x: number; y: number }; end?: { x: number; y: number } }[];
    };
    const shapes = cbox?.shapes ?? [];
    if (shapes.length >= 4 && shapes[0].start && shapes[1].end && shapes[2].end) {
      const minX = shapes[0].start.x;
      const minY = shapes[0].start.y;
      const maxX = shapes[1].end.x;
      const maxY = shapes[2].end.y;
      const childSet = new Set<number>();
      const children = (obj.children as { $?: string }[]) ?? [];
      for (const c of children) {
        if (c.$ && c.$.startsWith("/")) {
          const idx = Number.parseInt(c.$.slice(1), 10);
          if (Number.isFinite(idx)) childSet.add(idx);
        }
      }
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        isSection: true,
        childrenIndices: childSet,
      };
    }
  }
  return null;
}

/**
 * Check if line segment (x1, y1) -> (x2, y2) intersects rectangle [rx, ry, rw, rh].
 */
function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  // Liang-Barsky clipping algorithm
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };

  if (
    clip(-dx, x1 - rx) &&
    clip(dx, rx + rw - x1) &&
    clip(-dy, y1 - ry) &&
    clip(dy, ry + rh - y1)
  ) {
    // Require intersection strictly in the middle 75% of segment [0.12, 0.88] to avoid endpoint touching
    return t1 >= 0.12 && t0 <= 0.88 && t0 <= t1;
  }
  return false;
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

  // Tree edges (only emitted when parent is a non-Section entity, not synthetic root, and not Header Banner)
  for (const nodeId of orderedEntityIds) {
    const node = nodesById.get(nodeId)!;
    if (node.nodeType === "section" || node.text === "__synthetic_root__" || node.isHeaderBanner) {
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
        targetRectangleRate: makeVector(0.5, 0.5),
        sourceRectangleRate: makeVector(0.5, 0.5),
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
 * Includes Smart Edge Routing & Obstacle Avoidance:
 * - Parallel / bidirectional edges automatically curve away from each other (ArcEdge).
 * - Straight lines that intersect intermediate nodes automatically bend around obstacles using ArcEdge.
 * - Backward / feedback loops in DAGs automatically curve smoothly around the diagram.
 */
export function addExtraEdgesToStage(stage: StageObject[], extraEdges: ExtraEdge[]): void {
  const titleToIndex = new Map<string, number>();
  const stageRects = new Map<number, BoxRect>();

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
    const rect = getStageEntityRect(obj);
    if (rect) {
      stageRects.set(i, rect);
    }
  }

  // Group edges by unordered node pair to detect parallel / bidirectional edges
  const pairCounts = new Map<string, number>();
  const dirCounts = new Map<string, number>();
  const validEdges: { edge: ExtraEdge; fromIndex: number; toIndex: number }[] = [];

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

    const pairKey = fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`;
    pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
    validEdges.push({ edge, fromIndex, toIndex });
  }

  // Helper to check if a section contains an entity index (transitively)
  const isInsideSection = (secIdx: number, targetIdx: number): boolean => {
    const sec = stageRects.get(secIdx);
    if (!sec?.isSection || !sec.childrenIndices) return false;
    if (sec.childrenIndices.has(targetIdx)) return true;
    for (const cIdx of sec.childrenIndices) {
      if (isInsideSection(cIdx, targetIdx)) return true;
    }
    return false;
  };

  for (const { edge, fromIndex, toIndex } of validEdges) {
    const pairKey = fromIndex < toIndex ? `${fromIndex}:${toIndex}` : `${toIndex}:${fromIndex}`;
    const totalPairEdges = pairCounts.get(pairKey) ?? 1;
    const dirKey = `${fromIndex}->${toIndex}`;
    const dirIndex = dirCounts.get(dirKey) ?? 0;
    dirCounts.set(dirKey, dirIndex + 1);

    let useArc = edge.edgeType === "arc" || (edge.offset !== undefined && edge.offset !== 0);
    let offset = edge.offset ?? 75;

    const srcRect = stageRects.get(fromIndex);
    const tarRect = stageRects.get(toIndex);

    if (srcRect && tarRect) {
      const x1 = srcRect.x + srcRect.width / 2;
      const y1 = srcRect.y + srcRect.height / 2;
      const x2 = tarRect.x + tarRect.width / 2;
      const y2 = tarRect.y + tarRect.height / 2;

      // 1. Parallel / Bidirectional edges between the same pair
      if (!useArc && totalPairEdges > 1) {
        useArc = true;
        // Alternate offset sign for multiple edges in the same direction
        offset = dirIndex % 2 === 0 ? 85 : -85;
      }

      // 2. Obstacle Collision Check for straight edges
      if (!useArc) {
        let collides = false;
        const margin = 28;

        for (const [obsIdx, obsRect] of stageRects) {
          if (obsIdx === fromIndex || obsIdx === toIndex) continue;
          // Skip sections that contain either endpoint
          if (obsRect.isSection && (isInsideSection(obsIdx, fromIndex) || isInsideSection(obsIdx, toIndex))) {
            continue;
          }
          if (
            segmentIntersectsRect(
              x1,
              y1,
              x2,
              y2,
              obsRect.x - margin,
              obsRect.y - margin,
              obsRect.width + margin * 2,
              obsRect.height + margin * 2,
            )
          ) {
            collides = true;
            break;
          }
        }

        if (collides) {
          useArc = true;
          // Pick best collision-free offset among candidates
          const candidates = [110, -110, 170, -170, 230, -230, 300, -300];
          let bestOffset = 120;
          let minCollisions = 999;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy) || 1;
          const perpX = -dy / len;
          const perpY = dx / len;
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2;

          for (const cand of candidates) {
            const apexX = midX + perpX * cand;
            const apexY = midY + perpY * cand;
            let hitCount = 0;

            for (const [obsIdx, obsRect] of stageRects) {
              if (obsIdx === fromIndex || obsIdx === toIndex) continue;
              if (obsRect.isSection && (isInsideSection(obsIdx, fromIndex) || isInsideSection(obsIdx, toIndex))) {
                continue;
              }
              const rx = obsRect.x - 20;
              const ry = obsRect.y - 20;
              const rw = obsRect.width + 40;
              const rh = obsRect.height + 40;
              if (
                segmentIntersectsRect(x1, y1, apexX, apexY, rx, ry, rw, rh) ||
                segmentIntersectsRect(apexX, apexY, x2, y2, rx, ry, rw, rh)
              ) {
                hitCount++;
              }
            }

            if (hitCount < minCollisions) {
              minCollisions = hitCount;
              bestOffset = cand;
              if (hitCount === 0) break;
            }
          }
          offset = bestOffset;
        }
      }
    }

    if (useArc) {
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
        offset: roundToTwo(offset),
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
