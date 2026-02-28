export interface LayoutNode {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  children: string[];
}

export interface TreeLayoutOptions {
  horizontalGap?: number;
  verticalSpacing?: number;
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

function getNodeRect(node: LayoutNode): Rectangle {
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  };
}

function mergeRectangles(rectangles: Rectangle[]): Rectangle {
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

function moveSubtree(nodeId: string, dx: number, dy: number, nodesById: Map<string, LayoutNode>): void {
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

export function autoLayoutRightwardTree(
  rootId: string,
  nodesById: Map<string, LayoutNode>,
  options: TreeLayoutOptions = {},
): void {
  const horizontalGap = options.horizontalGap ?? 150;
  const verticalSpacing = options.verticalSpacing ?? 20;

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

    alignTrees(node.children, nodesById, verticalSpacing);
    adjustChildrenTreesByRootNodeLocation(nodeId, node.children, nodesById, horizontalGap);
  };

  dfs(rootId);

  const rootAfterLayout = nodesById.get(rootId);
  if (!rootAfterLayout) {
    throw new Error(`Root node missing after layout: ${rootId}`);
  }
  moveSubtree(rootId, rootOriginalX - rootAfterLayout.x, rootOriginalY - rootAfterLayout.y, nodesById);
}

/**
 * Estimate node size to match the app's TextNode auto-sizing behavior.
 * App formula: size = getMultiLineTextSize(text, fontSize=32, lineHeight=1.5) + padding*2
 * where padding = Renderer.NODE_PADDING = 14
 *
 * Without a real canvas measureText, we approximate:
 *   - English/ASCII chars: ~18px wide at 32px font
 *   - CJK / wide chars: ~32px wide at 32px font
 *   - Height per line: 32 * 1.5 = 48px
 *   - Total padding: 14 * 2 = 28px on each axis
 */
export function estimateNodeSize(text: string): { width: number; height: number } {
  const FONT_SIZE = 32;
  const LINE_HEIGHT = 1.5;
  const NODE_PADDING = 14;

  const lines = text.split("\n");
  let maxLineWidth = 0;

  for (const line of lines) {
    let lineWidth = 0;
    for (const char of line) {
      const code = char.codePointAt(0) ?? 0;
      // CJK Unified Ideographs, CJK punctuation, fullwidth forms, kana, hangul, etc.
      const isWide =
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
        (code >= 0x3000 && code <= 0x303f) || // CJK Symbols and Punctuation
        (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
        (code >= 0xff00 && code <= 0xffef) || // Fullwidth Forms
        (code >= 0xac00 && code <= 0xd7af) || // Hangul Syllables
        (code >= 0xf900 && code <= 0xfaff); // CJK Compatibility Ideographs
      lineWidth += isWide ? FONT_SIZE : FONT_SIZE * 0.55;
    }
    maxLineWidth = Math.max(maxLineWidth, lineWidth);
  }

  const width = maxLineWidth + NODE_PADDING * 2;
  const height = lines.length * FONT_SIZE * LINE_HEIGHT + NODE_PADDING * 2;

  return {
    width: Math.max(Math.round(width), 100),
    height: Math.max(Math.round(height), 76),
  };
}
