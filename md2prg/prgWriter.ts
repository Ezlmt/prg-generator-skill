import { randomUUID } from "node:crypto";
import type { LayoutNode } from "./treeLayout.js";

type StageObject = Record<string, unknown>;

export interface ExtraEdge {
  from: string;
  to: string;
  text?: string;
}

function roundToTwo(value: number): number {
  if (Number.isInteger(value)) {
    return value;
  }
  return Number.parseFloat(value.toFixed(2));
}

function getNodeOrder(rootId: string, nodesById: Map<string, LayoutNode>): string[] {
  const orderedIds: string[] = [];
  const visited = new Set<string>();

  const dfs = (nodeId: string): void => {
    if (visited.has(nodeId)) {
      return;
    }
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Node not found while building stage order: ${nodeId}`);
    }
    visited.add(nodeId);
    orderedIds.push(nodeId);
    for (const childId of node.children) {
      dfs(childId);
    }
  };

  dfs(rootId);

  for (const [nodeId] of nodesById) {
    if (!visited.has(nodeId)) {
      dfs(nodeId);
    }
  }

  return orderedIds;
}

export function buildStageFromLayout(rootId: string, nodesById: Map<string, LayoutNode>): StageObject[] {
  const orderedIds = getNodeOrder(rootId, nodesById);
  const stage: StageObject[] = [];
  const idToStageIndex = new Map<string, number>();

  for (const nodeId of orderedIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Node not found while building TextNode stage object: ${nodeId}`);
    }

    const stageIndex = stage.length;
    idToStageIndex.set(nodeId, stageIndex);

    stage.push({
      _: "TextNode",
      uuid: node.id,
      text: node.text,
      collisionBox: {
        _: "CollisionBox",
        shapes: [
          {
            _: "Rectangle",
            location: {
              _: "Vector",
              x: roundToTwo(node.x),
              y: roundToTwo(node.y),
            },
            size: {
              _: "Vector",
              x: roundToTwo(node.width),
              y: roundToTwo(node.height),
            },
          },
        ],
      },
      color: {
        _: "Color",
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      },
      fontScaleLevel: 0,
      sizeAdjust: "auto",
    });
  }

  for (const nodeId of orderedIds) {
    const node = nodesById.get(nodeId);
    if (!node) {
      throw new Error(`Node not found while building LineEdge stage object: ${nodeId}`);
    }
    const sourceIndex = idToStageIndex.get(nodeId);
    if (sourceIndex === undefined) {
      throw new Error(`Source index not found for node: ${nodeId}`);
    }

    for (const childId of node.children) {
      const targetIndex = idToStageIndex.get(childId);
      if (targetIndex === undefined) {
        throw new Error(`Target index not found for child node: ${childId}`);
      }

      stage.push({
        _: "LineEdge",
        uuid: randomUUID(),
        text: "",
        color: {
          _: "Color",
          r: 0,
          g: 0,
          b: 0,
          a: 0,
        },
        lineType: "solid",
        associationList: [{ $: `/${sourceIndex}` }, { $: `/${targetIndex}` }],
        sourceRectangleRate: {
          _: "Vector",
          x: roundToTwo(0.99),
          y: roundToTwo(0.5),
        },
        targetRectangleRate: {
          _: "Vector",
          x: roundToTwo(0.01),
          y: roundToTwo(0.5),
        },
      });
    }
  }

  return stage;
}

/**
 * Add extra (non-tree) edges to an existing stage array.
 * Matches nodes by their text field. Uses center-to-center direction (0.5, 0.5)
 * so the app treats them as "unknown direction" — visually distinct from tree edges.
 */
export function addExtraEdgesToStage(stage: StageObject[], extraEdges: ExtraEdge[]): void {
  // Build title → stageIndex mapping
  const titleToIndex = new Map<string, number>();
  for (let i = 0; i < stage.length; i++) {
    const obj = stage[i];
    if (obj._ === "TextNode" && typeof obj.text === "string") {
      // If multiple nodes share the same title, the first one wins
      if (!titleToIndex.has(obj.text)) {
        titleToIndex.set(obj.text, i);
      }
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

    stage.push({
      _: "LineEdge",
      uuid: randomUUID(),
      text: edge.text ?? "",
      color: {
        _: "Color",
        r: 0,
        g: 0,
        b: 0,
        a: 0,
      },
      lineType: "solid",
      associationList: [{ $: `/${fromIndex}` }, { $: `/${toIndex}` }],
      sourceRectangleRate: {
        _: "Vector",
        x: 0.5,
        y: 0.5,
      },
      targetRectangleRate: {
        _: "Vector",
        x: 0.5,
        y: 0.5,
      },
    });
  }
}

export async function createPrgFile(stage: StageObject[]): Promise<Uint8Array> {
  let msgpack: typeof import("@msgpack/msgpack");
  let zip: typeof import("@zip.js/zip.js");

  try {
    msgpack = await import("@msgpack/msgpack");
    zip = await import("@zip.js/zip.js");
  } catch (error) {
    throw new Error(
      `Missing runtime dependencies for .prg output. Install in tools/md2prg/: npm install. ${String(error)}`,
    );
  }

  const outputWriter = new zip.Uint8ArrayWriter();
  const writer = new zip.ZipWriter(outputWriter);

  await writer.add("stage.msgpack", new zip.Uint8ArrayReader(msgpack.encode(stage)));
  await writer.add("tags.msgpack", new zip.Uint8ArrayReader(msgpack.encode([])));
  await writer.add(
    "reference.msgpack",
    new zip.Uint8ArrayReader(
      msgpack.encode({
        sections: {},
        files: [],
      }),
    ),
  );
  await writer.add(
    "metadata.msgpack",
    new zip.Uint8ArrayReader(
      msgpack.encode({
        version: "18",
      }),
    ),
  );

  await writer.close();
  return outputWriter.getData();
}
