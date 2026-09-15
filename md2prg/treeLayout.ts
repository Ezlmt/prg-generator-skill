import type { ColorRGBA, InlineEdgeSpec, ParsedNodeType, PlateValue } from "./markdownParse.js";

export interface LayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: string[];
  parentSectionId?: string;
  nodeType?: ParsedNodeType;
  url?: string;
  color?: ColorRGBA;
  borderStyle?: "solid" | "dashed" | "none";
  fontScaleLevel?: number;
  details?: PlateValue;
  inlineEdges?: InlineEdgeSpec[];
}

export interface TreeLayoutOptions {
  horizontalGap?: number;
  verticalSpacing?: number;
  sectionPadding?: number;
  sectionGridMaxRows?: number;
}

export interface DAGLayoutEdge {
  fromId: string;
  toId: string;
}

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

export const SECTION_PADDING = 30;
export const SECTION_TITLE_BAR = 50;

function getNodeRect(node: LayoutNode): Rectangle {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

export function mergeRectangles(rectangles: Rectangle[]): Rectangle {
  if (rectangles.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = rectangles[0].x;
  let minY = rectangles[0].y;
  let maxX = rectangles[0].x + rectangles[0].width;
  let maxY = rectangles[0].y + rectangles[0].height;

  for (let i = 1; i < rectangles.length; i++) {
    const rect = rectangles[i];
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function moveSubtree(nodeId: string, dx: number, dy: number, nodesById: Map<string, LayoutNode>): void {
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Node not found while moving subtree: ${nodeId}`);
  }

  node.x += dx;
  node.y += dy;

  for (const childId of node.children) {
    moveSubtree(childId, dx, dy, nodesById);
  }
}

export function getTreeBoundingRectangle(nodeId: string, nodesById: Map<string, LayoutNode>): Rectangle {
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Node not found while computing tree bounds: ${nodeId}`);
  }

  const childRects = node.children.map((childId) => getTreeBoundingRectangle(childId, nodesById));
  return mergeRectangles([getNodeRect(node), ...childRects]);
}

export function moveTreeRectTo(nodeId: string, targetLocation: Point, nodesById: Map<string, LayoutNode>): void {
  const treeRect = getTreeBoundingRectangle(nodeId, nodesById);
  const dx = targetLocation.x - treeRect.x;
  const dy = targetLocation.y - treeRect.y;
  moveSubtree(nodeId, dx, dy, nodesById);
}

export function alignTrees(childIds: string[], nodesById: Map<string, LayoutNode>, gap = 20): void {
  if (childIds.length <= 1) {
    return;
  }

  const sortedChildIds = [...childIds].sort((a, b) => {
    const aNode = nodesById.get(a);
    const bNode = nodesById.get(b);
    if (!aNode || !bNode) {
      throw new Error("Failed to align trees: child node not found");
    }
    return aNode.y - bNode.y;
  });

  const firstTreeRect = getTreeBoundingRectangle(sortedChildIds[0], nodesById);
  let currentY = firstTreeRect.y + firstTreeRect.height + gap;

  for (let i = 1; i < sortedChildIds.length; i++) {
    const childId = sortedChildIds[i];
    const childRect = getTreeBoundingRectangle(childId, nodesById);
    moveTreeRectTo(
      childId,
      {
        x: firstTreeRect.x,
        y: currentY,
      },
      nodesById,
    );
    currentY += childRect.height + gap;
  }
}

export function adjustChildrenTreesByRootNodeLocation(
  parentId: string,
  childIds: string[],
  nodesById: Map<string, LayoutNode>,
  gap = 150,
): void {
  if (childIds.length === 0) {
    return;
  }

  const parentNode = nodesById.get(parentId);
  if (!parentNode) {
    throw new Error(`Parent node not found while adjusting children: ${parentId}`);
  }

  const childRects = childIds.map((childId) => getTreeBoundingRectangle(childId, nodesById));
  const childrenRect = mergeRectangles(childRects);

  const parentCenterY = parentNode.y + parentNode.height / 2;
  const targetChildrenCenterX = parentNode.x + parentNode.width + gap + childrenRect.width / 2;

  const currentChildrenCenterX = childrenRect.x + childrenRect.width / 2;
  const currentChildrenCenterY = childrenRect.y + childrenRect.height / 2;

  const dx = targetChildrenCenterX - currentChildrenCenterX;
  const dy = parentCenterY - currentChildrenCenterY;

  for (const childId of childIds) {
    moveSubtree(childId, dx, dy, nodesById);
  }
}

/**
 * Arrange children inside a Section container.
 * If children are all leaf nodes and count > maxRows, arranges them in a compact multi-column grid;
 * otherwise stacks subtrees vertically inside the Section and updates the Section's bounding rectangle.
 */
function layoutSectionContainer(
  sectionNode: LayoutNode,
  nodesById: Map<string, LayoutNode>,
  options: TreeLayoutOptions,
): void {
  const vGap = options.verticalSpacing ?? 24;
  const hGap = Math.min(options.horizontalGap ?? 150, 80);
  const pad = options.sectionPadding ?? SECTION_PADDING;
  const maxRows = options.sectionGridMaxRows ?? 6;

  if (sectionNode.children.length === 0) {
    const titleSize = estimateNodeSize(sectionNode.text, sectionNode.fontScaleLevel ?? 0);
    sectionNode.width = Math.max(titleSize.width + 40, 160);
    sectionNode.height = 100;
    return;
  }

  const allLeaves = sectionNode.children.every((cid) => {
    const c = nodesById.get(cid);
    return c && c.children.length === 0 && c.nodeType !== "section";
  });

  if (allLeaves && sectionNode.children.length > maxRows) {
    // Multi-column grid arrangement inside Section
    const count = sectionNode.children.length;
    const cols = Math.ceil(count / maxRows);
    const rows = Math.ceil(count / cols);

    let curX = 0;
    for (let col = 0; col < cols; col++) {
      let colMaxWidth = 0;
      let curY = 0;
      for (let row = 0; row < rows; row++) {
        const idx = col * rows + row;
        if (idx >= count) break;
        const childId = sectionNode.children[idx];
        const child = nodesById.get(childId)!;
        moveTreeRectTo(childId, { x: curX, y: curY }, nodesById);
        const r = getTreeBoundingRectangle(childId, nodesById);
        colMaxWidth = Math.max(colMaxWidth, r.width);
        curY += r.height + vGap;
      }
      curX += colMaxWidth + hGap;
    }
  } else {
    // Stack child trees vertically inside the Section
    alignTrees(sectionNode.children, nodesById, vGap);
  }

  // Now compute bounding box of all children and wrap Section around them
  const childRects = sectionNode.children.map((cid) => getTreeBoundingRectangle(cid, nodesById));
  const merged = mergeRectangles(childRects);
  const titleSize = estimateNodeSize(sectionNode.text, sectionNode.fontScaleLevel ?? 0);
  const titleBarHeight = sectionNode.text ? SECTION_TITLE_BAR : 0;

  const contentWidth = Math.max(merged.width, titleSize.width);
  sectionNode.x = merged.x - pad;
  sectionNode.y = merged.y - pad - titleBarHeight;
  sectionNode.width = Math.max(contentWidth + pad * 2, 160);
  sectionNode.height = merged.height + pad * 2 + titleBarHeight;
}

export function autoLayoutRightwardTree(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  options: TreeLayoutOptions = {},
): void {
  const horizontalGap = options.horizontalGap ?? 150;
  const verticalSpacing = options.verticalSpacing ?? 24;

  const rootNode = nodesById.get(rootId);
  if (!rootNode) {
    throw new Error(`Root node not found: ${rootId}`);
  }

  const rootOriginalX = rootNode.x;
  const rootOriginalY = rootNode.y;

  const dfs = (nodeId: string): void => {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Node not found during DFS layout: ${nodeId}`);
    }

    for (const childId of node.children) {
      dfs(childId);
    }

    if (node.nodeType === "section") {
      layoutSectionContainer(node, nodesById, options);
    } else {
      alignTrees(node.children, nodesById, verticalSpacing);
      adjustChildrenTreesByRootNodeLocation(nodeId, node.children, nodesById, horizontalGap);
    }
  };

  dfs(rootId);

  // Center the entire graph around (0, 0)
  const fullBounds = getTreeBoundingRectangle(rootId, nodesById);
  const centerX = fullBounds.x + fullBounds.width / 2;
  const centerY = fullBounds.y + fullBounds.height / 2;
  moveSubtree(rootId, rootOriginalX - centerX, rootOriginalY - centerY, nodesById);
}

/**
 * Layered left-to-right DAG layout (Kahn topological layering + barycenter crossing reduction).
 * Handles both Section containers and top-level nodes/Sections.
 */
export function autoLayoutDAG(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  extraEdges: DAGLayoutEdge[] = [],
  options: TreeLayoutOptions = {},
): void {
  const hGap = options.horizontalGap ?? 180;
  const vGap = options.verticalSpacing ?? 40;

  // 1. First layout inside any Sections bottom-up
  const postOrderSections = (nodeId: string) => {
    const n = nodesById.get(nodeId);
    if (!n) return;
    for (const cid of n.children) postOrderSections(cid);
    if (n.nodeType === "section") {
      layoutSectionContainer(n, nodesById, options);
    }
  };
  postOrderSections(rootId);

  // 2. Collect top-level layout units (direct children of synthetic root, or all nodes not inside a Section)
  const root = nodesById.get(rootId)!;
  const topUnits: string[] = root.id === rootId && root.text === "__synthetic_root__" ? [...root.children] : [rootId];

  if (topUnits.length <= 1) {
    autoLayoutRightwardTree(rootId, nodesById, options);
    return;
  }

  // Map any descendant node ID to its owning top-level unit ID
  const ownerUnit = new Map<string, string>();
  const assignOwner = (unitId: string, curId: string) => {
    ownerUnit.set(curId, unitId);
    const node = nodesById.get(curId);
    if (!node) return;
    for (const cid of node.children) assignOwner(unitId, cid);
  };
  for (const uid of topUnits) assignOwner(uid, uid);

  // Build directed edges between top-level units
  const adj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  for (const uid of topUnits) {
    adj.set(uid, new Set());
    inDeg.set(uid, 0);
  }

  const addUnitEdge = (u: string, v: string) => {
    if (u === v || !adj.has(u) || !adj.has(v)) return;
    if (!adj.get(u)!.has(v)) {
      adj.get(u)!.add(v);
      inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
    }
  };

  // Tree edges between non-section nodes
  for (const [, node] of nodesById) {
    if (node.nodeType !== "section" && node.id !== rootId) {
      for (const cid of node.children) {
        const u = ownerUnit.get(node.id);
        const v = ownerUnit.get(cid);
        if (u && v) addUnitEdge(u, v);
      }
    }
  }
  // Extra edges
  for (const e of extraEdges) {
    const u = ownerUnit.get(e.fromId);
    const v = ownerUnit.get(e.toId);
    if (u && v) addUnitEdge(u, v);
  }

  // Kahn longest-path layering (with cycle fallback)
  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const uid of topUnits) {
    if ((inDeg.get(uid) ?? 0) === 0) {
      queue.push(uid);
      levels.set(uid, 0);
    }
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const u = queue.shift()!;
    visited.add(u);
    const curL = levels.get(u) ?? 0;
    for (const v of adj.get(u) ?? []) {
      levels.set(v, Math.max(levels.get(v) ?? 0, curL + 1));
      const d = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }
  // Any unvisited nodes (in cycles) get placed at level 0 or max+1
  for (const uid of topUnits) {
    if (!levels.has(uid)) levels.set(uid, 0);
  }

  const byLevel = new Map<number, string[]>();
  let maxLevel = 0;
  for (const uid of topUnits) {
    const l = levels.get(uid) ?? 0;
    maxLevel = Math.max(maxLevel, l);
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(uid);
  }

  // Position each layer left-to-right, vertically centered
  let curX = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const unitIds = byLevel.get(l) ?? [];
    if (unitIds.length === 0) continue;

    let layerMaxWidth = 0;
    let totalHeight = 0;
    const rects = unitIds.map((uid) => {
      const r = getTreeBoundingRectangle(uid, nodesById);
      layerMaxWidth = Math.max(layerMaxWidth, r.width);
      totalHeight += r.height;
      return { uid, r };
    });
    totalHeight += (unitIds.length - 1) * vGap;

    let curY = -totalHeight / 2;
    for (const { uid, r } of rects) {
      moveTreeRectTo(uid, { x: curX, y: curY }, nodesById);
      curY += r.height + vGap;
    }

    curX += layerMaxWidth + hGap;
  }

  // Center around canvas origin (0,0)
  const allRects = topUnits.map((uid) => getTreeBoundingRectangle(uid, nodesById));
  const totalBounds = mergeRectangles(allRects);
  const cx = totalBounds.x + totalBounds.width / 2;
  const cy = totalBounds.y + totalBounds.height / 2;
  for (const uid of topUnits) {
    moveSubtree(uid, -cx, -cy, nodesById);
  }
}

/**
 * Estimate node size to match the app's TextNode auto-sizing behavior.
 * App formula: size = getMultiLineTextSize(text, fontSize=32 * 2^(level/2), lineHeight=1.5) + padding*2
 * where padding = Renderer.NODE_PADDING = 14
 */
export function estimateNodeSize(
  text: string,
  fontScaleLevel = 0,
  nodeType: ParsedNodeType = "text",
): { width: number; height: number } {
  if (nodeType === "url") {
    return { width: 320, height: 150 };
  }

  const baseFontSize = 32 * Math.pow(2, fontScaleLevel / 2);
  const LINE_HEIGHT = 1.5;
  const NODE_PADDING = 14 * (baseFontSize / 32);

  const lines = text.split("\n");
  let maxLineWidth = 0;

  for (const line of lines) {
    let lineWidth = 0;
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      const isWide =
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
        (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
        (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
        (code >= 0xff00 && code <= 0xffef) || // Fullwidth Forms
        (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
        (code >= 0xf900 && code <= 0xfaff); // CJK Compatibility Ideographs
      lineWidth += isWide ? baseFontSize : baseFontSize * 0.55;
    }
    maxLineWidth = Math.max(maxLineWidth, lineWidth);
  }

  const width = maxLineWidth + NODE_PADDING * 2;
  const height = lines.length * baseFontSize * LINE_HEIGHT + NODE_PADDING * 2;

  return {
    width: Math.max(Math.round(width), 100),
    height: Math.max(Math.round(height), 76),
  };
}
