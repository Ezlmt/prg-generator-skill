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
  isHeaderBanner?: boolean;
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
  text?: string;
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

/**
 * Project Graph runtime Section padding constants (from Section.tsx adjustLocationAndSize):
 * - Left / Right / Bottom margin around children bounding box = 30px
 * - Top margin = 30px + 50px title bar = 80px
 */
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

  if (node.nodeType === "section") {
    return getNodeRect(node);
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

export function alignTrees(childIds: string[], nodesById: Map<string, LayoutNode>, gap = 100): void {
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
  gap = 240,
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
 * Update a Section node's bounding box to match Project Graph's runtime Section.adjustLocationAndSize()
 * (30px padding around children + 50px top title bar).
 * If the title text is wider than the children bounding box, center the children horizontally under the title.
 */
function updateSectionBoundsFromChildren(sectionNode: LayoutNode, nodesById: Map<string, LayoutNode>): void {
  const pad = SECTION_PADDING; // 30
  const titleBar = sectionNode.text ? SECTION_TITLE_BAR : 0; // 50
  const titleSize = estimateNodeSize(sectionNode.text, sectionNode.fontScaleLevel ?? 0);

  if (sectionNode.children.length === 0) {
    sectionNode.width = Math.max(titleSize.width + 40, 200);
    sectionNode.height = 120;
    return;
  }

  let childRects = sectionNode.children.map((cid) => getTreeBoundingRectangle(cid, nodesById));
  let merged = mergeRectangles(childRects);

  const minContentWidth = titleSize.width + 20;
  if (merged.width < minContentWidth) {
    const shiftX = (minContentWidth - merged.width) / 2;
    for (const cid of sectionNode.children) {
      moveSubtree(cid, shiftX, 0, nodesById);
    }
    childRects = sectionNode.children.map((cid) => getTreeBoundingRectangle(cid, nodesById));
    merged = mergeRectangles(childRects);
  }

  const contentWidth = Math.max(merged.width, minContentWidth);
  sectionNode.x = merged.x - pad;
  sectionNode.y = merged.y - pad - titleBar;
  sectionNode.width = Math.max(contentWidth + pad * 2, 200);
  sectionNode.height = merged.height + pad * 2 + titleBar;
}

/**
 * Rightward Tree Layout (used when --layout tree is explicitly requested).
 * Uses spacious gaps so nodes and edges never overlap.
 */
export function autoLayoutRightwardTree(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  options: TreeLayoutOptions = {},
): void {
  const horizontalGap = options.horizontalGap ?? 260;
  const verticalSpacing = options.verticalSpacing ?? 110;

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
      // Arrange section children in a 2D grid or vertical stack with generous spacing
      if (node.children.length > 0) {
        alignTrees(node.children, nodesById, verticalSpacing);
      }
      updateSectionBoundsFromChildren(node, nodesById);
    } else if (node.children.length > 0) {
      alignTrees(node.children, nodesById, verticalSpacing);
      adjustChildrenTreesByRootNodeLocation(nodeId, node.children, nodesById, horizontalGap);
    }
  };

  dfs(rootId);

  const fullBounds = getTreeBoundingRectangle(rootId, nodesById);
  const centerX = fullBounds.x + fullBounds.width / 2;
  const centerY = fullBounds.y + fullBounds.height / 2;
  moveSubtree(rootId, rootOriginalX - centerX, rootOriginalY - centerY, nodesById);
}

/**
 * Collect all directed edges (tree edges + inline edges + extra edges) across the entire graph.
 */
function collectAllGraphEdges(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  extraEdges: DAGLayoutEdge[],
): DAGLayoutEdge[] {
  const allEdges: DAGLayoutEdge[] = [...extraEdges];

  // Build title -> id map for inline edge resolution
  const titleToId = new Map<string, string>();
  for (const [id, n] of nodesById) {
    if (n.text && n.text !== "__synthetic_root__" && !titleToId.has(n.text)) {
      titleToId.set(n.text, id);
    }
  }

  for (const [id, node] of nodesById) {
    // Tree edges from non-section, non-synthetic-root parents to their children
    if (node.nodeType !== "section" && node.text !== "__synthetic_root__" && !node.isHeaderBanner) {
      for (const cid of node.children) {
        allEdges.push({ fromId: id, toId: cid });
      }
    }
    // Inline edges declared on the node
    if (node.inlineEdges) {
      for (const ie of node.inlineEdges) {
        const fromId = titleToId.get(ie.from) ?? id;
        const toId = titleToId.get(ie.to);
        if (fromId && toId && fromId !== toId) {
          allEdges.push({ fromId, toId, text: ie.text });
        }
      }
    }
  }

  return allEdges;
}

/**
 * Partition units into Weakly Connected Components while preserving original declaration order.
 */
function getConnectedComponents(units: string[], undirectedAdj: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const u of units) {
    if (visited.has(u)) continue;
    const comp: string[] = [];
    const queue: string[] = [u];
    visited.add(u);
    while (queue.length > 0) {
      const curr = queue.shift()!;
      comp.push(curr);
      for (const nxt of undirectedAdj.get(curr) ?? []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    // Sort component members by their original index in `units` for stability
    const orderMap = new Map(units.map((id, idx) => [id, idx]));
    comp.sort((a, b) => (orderMap.get(a) ?? 0) - (orderMap.get(b) ?? 0));
    components.push(comp);
  }

  return components;
}

/**
 * Break cycles in a directed subgraph using DFS back-edge detection.
 * Returns a forward adjacency map that is guaranteed to be a DAG.
 */
function buildAcyclicForwardGraph(
  comp: string[],
  directedAdj: Map<string, Set<string>>,
): { forwardAdj: Map<string, Set<string>>; inDeg: Map<string, number> } {
  const compSet = new Set(comp);
  const forwardAdj = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();

  for (const u of comp) {
    forwardAdj.set(u, new Set());
    inDeg.set(u, 0);
  }

  // Compute initial in-degree to prefer starting DFS from sources
  const rawInDeg = new Map<string, number>();
  const rawOutDeg = new Map<string, number>();
  for (const u of comp) {
    rawInDeg.set(u, 0);
    rawOutDeg.set(u, 0);
  }
  for (const u of comp) {
    for (const v of directedAdj.get(u) ?? []) {
      if (compSet.has(v) && u !== v) {
        rawOutDeg.set(u, (rawOutDeg.get(u) ?? 0) + 1);
        rawInDeg.set(v, (rawInDeg.get(v) ?? 0) + 1);
      }
    }
  }

  // Order nodes: sources (inDeg === 0) first, then by (inDeg - outDeg) ascending, then declaration order
  const orderIndex = new Map(comp.map((id, idx) => [id, idx]));
  const dfsOrder = [...comp].sort((a, b) => {
    const inA = rawInDeg.get(a) ?? 0;
    const inB = rawInDeg.get(b) ?? 0;
    if (inA === 0 && inB !== 0) return -1;
    if (inB === 0 && inA !== 0) return 1;
    const scoreA = inA - (rawOutDeg.get(a) ?? 0);
    const scoreB = inB - (rawOutDeg.get(b) ?? 0);
    if (scoreA !== scoreB) return scoreA - scoreB;
    return (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);
  });

  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (u: string) => {
    visited.add(u);
    inStack.add(u);

    const neighbors = [...(directedAdj.get(u) ?? [])].filter((v) => compSet.has(v) && u !== v);
    neighbors.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));

    for (const v of neighbors) {
      if (inStack.has(v)) {
        // Back-edge (feedback loop): omit from forward DAG so it doesn't create a cycle!
        continue;
      }
      forwardAdj.get(u)!.add(v);
      if (!visited.has(v)) {
        dfs(v);
      }
    }

    inStack.delete(u);
  };

  for (const startNode of dfsOrder) {
    if (!visited.has(startNode)) {
      dfs(startNode);
    }
  }

  for (const u of comp) {
    for (const v of forwardAdj.get(u)!) {
      inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
    }
  }

  return { forwardAdj, inDeg };
}

/**
 * Layout a single connected component of units using Longest-Path Layering + Barycenter Ordering
 * + Boustrophedon (Snake) Row Wrapping for long chains so graphs maintain a balanced 2D aspect ratio.
 */
function layoutConnectedComponent(
  comp: string[],
  directedAdj: Map<string, Set<string>>,
  pairMaxLabelWidth: Map<string, number>,
  nodesById: Map<string, LayoutNode>,
  depth: number,
  baseHGap: number,
  baseVGap: number,
  reverseHorizontal = false,
): { rect: Rectangle; oddRowUnits: Set<string> } {
  const oddRowUnits = new Set<string>();
  if (comp.length === 1) {
    moveTreeRectTo(comp[0], { x: 0, y: 0 }, nodesById);
    return { rect: getTreeBoundingRectangle(comp[0], nodesById), oddRowUnits };
  }

  // Check if there are any directed edges within this component
  let edgeCount = 0;
  for (const u of comp) {
    for (const v of directedAdj.get(u) ?? []) {
      if (comp.includes(v) && u !== v) edgeCount++;
    }
  }

  // Case A: Disconnected set of nodes (no edges between them) -> Arrange in a balanced 2D grid
  if (edgeCount === 0) {
    const count = comp.length;
    const cols = count === 2 ? 2 : Math.ceil(Math.sqrt(count * 1.5));
    const hGap = depth === 0 ? Math.max(baseHGap, 300) : Math.max(baseHGap, 220);
    const vGap = depth === 0 ? Math.max(baseVGap, 180) : Math.max(baseVGap, 110);

    let curY = 0;
    for (let r = 0; r < Math.ceil(count / cols); r++) {
      let curX = 0;
      let rowMaxH = 0;
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= count) break;
        const uid = comp[idx];
        moveTreeRectTo(uid, { x: curX, y: curY }, nodesById);
        const rect = getTreeBoundingRectangle(uid, nodesById);
        curX += rect.width + hGap;
        rowMaxH = Math.max(rowMaxH, rect.height);
      }
      curY += rowMaxH + vGap;
    }

    return { rect: mergeRectangles(comp.map((uid) => getTreeBoundingRectangle(uid, nodesById))), oddRowUnits };
  }

  // Case B: Connected DAG component
  const { forwardAdj, inDeg } = buildAcyclicForwardGraph(comp, directedAdj);

  // Longest-path topological layering
  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const u of comp) {
    if ((inDeg.get(u) ?? 0) === 0) {
      queue.push(u);
      levels.set(u, 0);
    }
  }

  while (queue.length > 0) {
    const u = queue.shift()!;
    const curL = levels.get(u) ?? 0;
    for (const v of forwardAdj.get(u) ?? []) {
      levels.set(v, Math.max(levels.get(v) ?? 0, curL + 1));
      const d = (inDeg.get(v) ?? 1) - 1;
      inDeg.set(v, d);
      if (d === 0) {
        queue.push(v);
      }
    }
  }

  for (const u of comp) {
    if (!levels.has(u)) levels.set(u, 0);
  }

  let maxLevel = 0;
  const byLevel = new Map<number, string[]>();
  for (const u of comp) {
    const l = levels.get(u) ?? 0;
    maxLevel = Math.max(maxLevel, l);
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(u);
  }

  // Barycenter crossing reduction (4 sweeps)
  const orderIndex = new Map(comp.map((id, idx) => [id, idx]));
  const getBarycenter = (u: string, neighborLayer: string[], useIncoming: boolean): number => {
    const posMap = new Map(neighborLayer.map((id, idx) => [id, idx]));
    let sum = 0;
    let count = 0;
    if (useIncoming) {
      for (const v of neighborLayer) {
        if (forwardAdj.get(v)?.has(u)) {
          sum += posMap.get(v)!;
          count++;
        }
      }
    } else {
      for (const v of forwardAdj.get(u) ?? []) {
        if (posMap.has(v)) {
          sum += posMap.get(v)!;
          count++;
        }
      }
    }
    return count > 0 ? sum / count : (orderIndex.get(u) ?? 0);
  };

  for (let sweep = 0; sweep < 4; sweep++) {
    for (let l = 1; l <= maxLevel; l++) {
      const prevLayer = byLevel.get(l - 1) ?? [];
      const curLayer = byLevel.get(l) ?? [];
      curLayer.sort((a, b) => getBarycenter(a, prevLayer, true) - getBarycenter(b, prevLayer, true));
    }
    for (let l = maxLevel - 1; l >= 0; l--) {
      const nextLayer = byLevel.get(l + 1) ?? [];
      const curLayer = byLevel.get(l) ?? [];
      curLayer.sort((a, b) => getBarycenter(a, nextLayer, false) - getBarycenter(b, nextLayer, false));
    }
  }

  const totalLayers = maxLevel + 1;

  // Estimate single-row width to decide whether to wrap into multiple rows
  let singleRowWidth = 0;
  for (let l = 0; l <= maxLevel; l++) {
    const unitIds = byLevel.get(l) ?? [];
    let layerW = 0;
    for (const uid of unitIds) {
      layerW = Math.max(layerW, getTreeBoundingRectangle(uid, nodesById).width);
    }
    singleRowWidth += layerW + (l > 0 ? baseHGap : 0);
  }

  // Determine max layers per row:
  // - Root level (depth === 0): if >= 4 layers or singleRowWidth > 2600, wrap into 2 or 3 columns per row
  // - Inside a Section (depth >= 1): if >= 3 layers and singleRowWidth > 1150, wrap into 2 columns per row
  const maxLayersPerRow =
    depth === 0
      ? totalLayers === 4
        ? 2
        : totalLayers >= 5
          ? 3
          : singleRowWidth > 2600 && totalLayers >= 3
            ? 2
            : totalLayers
      : totalLayers >= 3 && singleRowWidth > 1150
        ? 2
        : totalLayers >= 4
          ? 2
          : totalLayers;

  const numRows = Math.ceil(totalLayers / maxLayersPerRow);
  const rowGap = depth === 0 ? Math.max(baseVGap, 240) : Math.max(baseVGap, 130);

  // Helper to compute required horizontal gap between two adjacent layers
  const getGapBetweenLayers = (layerA: string[], layerB: string[]): number => {
    let reqGap = baseHGap;
    for (const u of layerA) {
      for (const v of layerB) {
        const labelW = Math.max(
          pairMaxLabelWidth.get(`${u}->${v}`) ?? 0,
          pairMaxLabelWidth.get(`${v}->${u}`) ?? 0,
        );
        if (labelW > 0) {
          reqGap = Math.max(reqGap, labelW + 140);
        }
      }
    }
    return reqGap;
  };

  let currentRowY = 0;
  let prevRowTurnRightEdge = 0;
  let prevRowTurnLeftEdge = 0;

  for (let r = 0; r < numRows; r++) {
    const startL = r * maxLayersPerRow;
    const endL = Math.min(totalLayers - 1, (r + 1) * maxLayersPerRow - 1);
    const rowLevels: number[] = [];
    for (let l = startL; l <= endL; l++) {
      rowLevels.push(l);
    }

    const isRowReversed = reverseHorizontal ? r % 2 === 0 : r % 2 === 1;
    if (isRowReversed) {
      for (const l of rowLevels) {
        for (const uid of byLevel.get(l) ?? []) {
          oddRowUnits.add(uid);
        }
      }
    }

    // Compute dimensions (width, height) of each layer in this row
    const layerDims = new Map<number, { width: number; height: number }>();
    let maxRowHeight = 0;

    for (const l of rowLevels) {
      const unitIds = byLevel.get(l) ?? [];
      let maxW = 0;
      let totalH = 0;
      for (let i = 0; i < unitIds.length; i++) {
        const rect = getTreeBoundingRectangle(unitIds[i], nodesById);
        maxW = Math.max(maxW, rect.width);
        totalH += rect.height;
        if (i > 0) totalH += baseVGap;
      }
      layerDims.set(l, { width: maxW, height: totalH });
      maxRowHeight = Math.max(maxRowHeight, totalH);
    }

    // Compute X position for each layer in this row using Row-Relative Snake alignment
    const layerX = new Map<number, number>();

    if (!isRowReversed) {
      // Left-to-Right row (Row 0, 2, ...)
      let curX = r === 0 ? 0 : prevRowTurnLeftEdge;
      for (let idx = 0; idx < rowLevels.length; idx++) {
        const l = rowLevels[idx];
        const dim = layerDims.get(l)!;
        if (idx > 0) {
          const prevL = rowLevels[idx - 1];
          const prevDim = layerDims.get(prevL)!;
          const gap = getGapBetweenLayers(byLevel.get(prevL) ?? [], byLevel.get(l) ?? []);
          curX += prevDim.width + gap;
        }
        layerX.set(l, curX);
      }
      const lastL = rowLevels[rowLevels.length - 1];
      prevRowTurnRightEdge = layerX.get(lastL)! + layerDims.get(lastL)!.width;
    } else {
      // Right-to-Left row (Row 1, 3, ...): start from the right edge of previous row's last layer and march left!
      const firstL = rowLevels[0];
      const firstDim = layerDims.get(firstL)!;
      let curX = r === 0 ? 0 : prevRowTurnRightEdge - firstDim.width;
      layerX.set(firstL, curX);

      for (let idx = 1; idx < rowLevels.length; idx++) {
        const prevL = rowLevels[idx - 1];
        const l = rowLevels[idx];
        const dim = layerDims.get(l)!;
        const gap = getGapBetweenLayers(byLevel.get(prevL) ?? [], byLevel.get(l) ?? []);
        curX = curX - gap - dim.width;
        layerX.set(l, curX);
      }
      const lastL = rowLevels[rowLevels.length - 1];
      prevRowTurnLeftEdge = layerX.get(lastL)!;
    }

    // Position nodes within each layer of this row
    for (const l of rowLevels) {
      const unitIds = byLevel.get(l) ?? [];
      const dim = layerDims.get(l)!;
      const startY = currentRowY + (maxRowHeight - dim.height) / 2;
      const lx = layerX.get(l) ?? 0;

      let curY = startY;
      for (const uid of unitIds) {
        const rect = getTreeBoundingRectangle(uid, nodesById);
        const alignedX = lx + (dim.width - rect.width) / 2;
        moveTreeRectTo(uid, { x: alignedX, y: curY }, nodesById);
        curY += rect.height + baseVGap;
      }
    }

    currentRowY += maxRowHeight + rowGap;
  }

  return { rect: mergeRectangles(comp.map((uid) => getTreeBoundingRectangle(uid, nodesById))), oddRowUnits };
}

/**
 * Recursive Hierarchical DAG Layout Engine.
 * Applies Sugiyama layered DAG + 2D Boustrophedon Snake / Grid layout at EVERY container level
 * (both inside Section containers AND across top-level canvas Sections/nodes).
 */
function layoutContainerHierarchyDAG(
  containerId: string,
  nodesById: Map<string, LayoutNode>,
  allEdges: DAGLayoutEdge[],
  options: TreeLayoutOptions,
  depth: number,
  reverseHorizontal = false,
): void {
  const container = nodesById.get(containerId);
  if (!container) return;

  // 1. Bottom-up: recursively layout any child containers / Sections first
  for (const cid of container.children) {
    const child = nodesById.get(cid);
    if (child && child.children.length > 0 && !child.isHeaderBanner) {
      layoutContainerHierarchyDAG(cid, nodesById, allEdges, options, depth + 1, reverseHorizontal);
    }
  }

  // 2. Identify direct layout units (excluding any Header Banner node)
  const units = container.children.filter((cid) => {
    const c = nodesById.get(cid);
    return c && !c.isHeaderBanner;
  });

  if (units.length === 0) {
    if (container.nodeType === "section") {
      updateSectionBoundsFromChildren(container, nodesById);
    }
    return;
  }

  if (units.length === 1) {
    moveTreeRectTo(units[0], { x: 0, y: 0 }, nodesById);
    if (container.nodeType === "section") {
      updateSectionBoundsFromChildren(container, nodesById);
    }
    return;
  }

  // 3. Map every descendant node ID to its owning direct unit in `units`
  const ownerUnit = new Map<string, string>();
  const assignOwner = (unitId: string, curId: string) => {
    ownerUnit.set(curId, unitId);
    const n = nodesById.get(curId);
    if (!n) return;
    for (const cid of n.children) {
      assignOwner(unitId, cid);
    }
  };
  for (const uid of units) {
    assignOwner(uid, uid);
  }

  // 4. Build induced directed and undirected adjacency graphs among `units`
  const directedAdj = new Map<string, Set<string>>();
  const undirectedAdj = new Map<string, Set<string>>();
  const pairMaxLabelWidth = new Map<string, number>();

  for (const uid of units) {
    directedAdj.set(uid, new Set());
    undirectedAdj.set(uid, new Set());
  }

  for (const edge of allEdges) {
    const u = ownerUnit.get(edge.fromId);
    const v = ownerUnit.get(edge.toId);
    if (u && v && u !== v && directedAdj.has(u) && directedAdj.has(v)) {
      directedAdj.get(u)!.add(v);
      undirectedAdj.get(u)!.add(v);
      undirectedAdj.get(v)!.add(u);
      if (edge.text) {
        const labelW = estimateNodeSize(edge.text).width;
        const key = `${u}->${v}`;
        pairMaxLabelWidth.set(key, Math.max(pairMaxLabelWidth.get(key) ?? 0, labelW));
      }
    }
  }

  // 5. Partition into connected components and lay out each component
  const components = getConnectedComponents(units, undirectedAdj);
  const baseHGap = depth === 0 ? Math.max(options.horizontalGap ?? 360, 340) : Math.max(options.horizontalGap ?? 260, 240);
  const baseVGap = depth === 0 ? Math.max(options.verticalSpacing ?? 220, 200) : Math.max(options.verticalSpacing ?? 120, 100);

  const compBounds: { comp: string[]; rect: Rectangle }[] = [];
  for (const comp of components) {
    const { rect, oddRowUnits } = layoutConnectedComponent(
      comp,
      directedAdj,
      pairMaxLabelWidth,
      nodesById,
      depth,
      baseHGap,
      baseVGap,
      reverseHorizontal,
    );

    // If any child Section ended up in a reversed odd snake row, mirror its internal flow right-to-left
    // so its entry/exit nodes align naturally with the clockwise snake flow!
    if (oddRowUnits.size > 0) {
      for (const uid of oddRowUnits) {
        const uNode = nodesById.get(uid);
        if (uNode && uNode.children.length > 0) {
          const oldRect = getTreeBoundingRectangle(uid, nodesById);
          layoutContainerHierarchyDAG(uid, nodesById, allEdges, options, depth + 1, !reverseHorizontal);
          moveTreeRectTo(uid, { x: oldRect.x, y: oldRect.y }, nodesById);
        }
      }
    }

    compBounds.push({ comp, rect: mergeRectangles(comp.map((uid) => getTreeBoundingRectangle(uid, nodesById))) });
  }

  // 6. Arrange multiple connected components in a clean 2D flow
  if (compBounds.length > 1) {
    const maxRowWidth = depth === 0 ? 3400 : 1800;
    const compHGap = depth === 0 ? 360 : 240;
    const compVGap = depth === 0 ? 240 : 140;

    let curX = 0;
    let curY = 0;
    let rowMaxH = 0;

    for (let i = 0; i < compBounds.length; i++) {
      const { comp, rect } = compBounds[i];
      if (i > 0 && curX + rect.width > maxRowWidth) {
        curX = 0;
        curY += rowMaxH + compVGap;
        rowMaxH = 0;
      }

      const dx = curX - rect.x;
      const dy = curY - rect.y;
      for (const uid of comp) {
        moveSubtree(uid, dx, dy, nodesById);
      }

      curX += rect.width + compHGap;
      rowMaxH = Math.max(rowMaxH, rect.height);
    }
  }

  // 7. If this container is a Section, update its bounding rectangle to wrap all children cleanly
  if (container.nodeType === "section") {
    updateSectionBoundsFromChildren(container, nodesById);
  }
}

/**
 * Hierarchical Layered DAG Layout Engine.
 * Lays out both internal Section subgraphs and top-level canvas entities with generous,
 * discrete, label-aware spacing so nodes and edges never cram or overlap.
 */
export function autoLayoutDAG(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  extraEdges: DAGLayoutEdge[] = [],
  options: TreeLayoutOptions = {},
): void {
  const allEdges = collectAllGraphEdges(rootId, nodesById, extraEdges);

  // Run recursive bottom-up + top-down DAG layout starting at rootId (depth 0)
  layoutContainerHierarchyDAG(rootId, nodesById, allEdges, options, 0);

  const root = nodesById.get(rootId)!;
  const nonBannerChildren = root.children.filter((cid) => !nodesById.get(cid)?.isHeaderBanner);
  const bannerChildren = root.children.filter((cid) => nodesById.get(cid)?.isHeaderBanner);

  if (nonBannerChildren.length === 0) return;

  // Center main graph around canvas origin (0, 0)
  const mainRects = nonBannerChildren.map((cid) => getTreeBoundingRectangle(cid, nodesById));
  const mainBounds = mergeRectangles(mainRects);
  const cx = mainBounds.x + mainBounds.width / 2;
  const cy = mainBounds.y + mainBounds.height / 2;

  for (const cid of nonBannerChildren) {
    moveSubtree(cid, -cx, -cy, nodesById);
  }

  // Position any Header Banner node cleanly centered above the top of the diagram
  if (bannerChildren.length > 0) {
    const updatedBounds = mergeRectangles(nonBannerChildren.map((cid) => getTreeBoundingRectangle(cid, nodesById)));
    let bannerY = updatedBounds.y - 120;
    for (let i = bannerChildren.length - 1; i >= 0; i--) {
      const bid = bannerChildren[i];
      const bNode = nodesById.get(bid)!;
      bannerY -= bNode.height;
      const bannerX = updatedBounds.x + (updatedBounds.width - bNode.width) / 2;
      moveTreeRectTo(bid, { x: bannerX, y: bannerY }, nodesById);
      bannerY -= 60;
    }
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
    width: Math.max(Math.round(width), 120),
    height: Math.max(Math.round(height), 76),
  };
}
