export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface PlateLeaf {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export interface PlateBlock {
  type: string;
  lang?: string;
  children: Array<PlateLeaf | PlateBlock>;
}

export type PlateValue = PlateBlock[];

export interface InlineEdgeSpec {
  from: string;
  to: string;
  text?: string;
  edgeType?: "line" | "arc";
  lineType?: "solid" | "dashed";
  offset?: number;
  color?: ColorRGBA;
}

export type ParsedNodeType = "text" | "section" | "url" | "latex";

export interface MarkdownNode {
  title: string;
  rawTitle: string;
  content: string;
  details: PlateValue;
  nodeType: ParsedNodeType;
  url?: string;
  color?: ColorRGBA;
  borderStyle?: "solid" | "dashed" | "none";
  fontScaleLevel?: number;
  inlineEdges: InlineEdgeSpec[];
  children: MarkdownNode[];
}

export interface ParsedMarkdownDocument {
  nodes: MarkdownNode[];
  inlineEdges: InlineEdgeSpec[];
}

/**
 * Built-in semantic color palette designed for high contrast and pleasant visual grouping in Project Graph.
 */
export const SEMANTIC_COLORS: Record<string, ColorRGBA> = {
  blue: { r: 56, g: 126, b: 177, a: 1 },
  green: { r: 59, g: 114, b: 60, a: 1 },
  red: { r: 194, g: 64, b: 64, a: 1 },
  yellow: { r: 204, g: 153, b: 43, a: 1 },
  purple: { r: 126, g: 87, b: 194, a: 1 },
  orange: { r: 217, g: 119, b: 36, a: 1 },
  cyan: { r: 38, g: 166, b: 154, a: 1 },
  gray: { r: 110, g: 118, b: 129, a: 1 },
};

export const SECTION_PALETTE: ColorRGBA[] = [
  { r: 56, g: 126, b: 177, a: 0.18 },
  { r: 106, g: 166, b: 69, a: 0.18 },
  { r: 126, g: 87, b: 194, a: 0.18 },
  { r: 217, g: 119, b: 36, a: 0.18 },
  { r: 38, g: 166, b: 154, a: 0.18 },
  { r: 194, g: 64, b: 64, a: 0.18 },
];

function parseColorSpec(spec: string): ColorRGBA | undefined {
  const lower = spec.trim().toLowerCase();
  if (lower in SEMANTIC_COLORS) {
    return { ...SEMANTIC_COLORS[lower] };
  }
  const hexMatch = lower.match(/^#?([0-9a-f]{6})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgbaMatch = lower.match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?$/);
  if (rgbaMatch) {
    return {
      r: Number(rgbaMatch[1]),
      g: Number(rgbaMatch[2]),
      b: Number(rgbaMatch[3]),
      a: rgbaMatch[4] !== undefined ? Number(rgbaMatch[4]) : 1,
    };
  }
  return undefined;
}

interface HeadingDirectives {
  cleanTitle: string;
  nodeType: ParsedNodeType;
  url?: string;
  color?: ColorRGBA;
  borderStyle?: "solid" | "dashed" | "none";
  fontScaleLevel?: number;
}

function parseHeadingDirectives(rawTitle: string): HeadingDirectives {
  let title = rawTitle.trim();
  let nodeType: ParsedNodeType = "text";
  let url: string | undefined;
  let color: ColorRGBA | undefined;
  let borderStyle: "solid" | "dashed" | "none" | undefined;
  let fontScaleLevel: number | undefined;

  // [section] or {section}
  if (/(\[section\]|\{section\})/i.test(title)) {
    nodeType = "section";
    title = title.replace(/(\[section\]|\{section\})/gi, "").trim();
  }

  // [latex]
  if (/\[latex\]/i.test(title)) {
    nodeType = "latex";
    title = title.replace(/\[latex\]/gi, "").trim();
  }

  // [url:https://...]
  const urlMatch = title.match(/\[url:([^\]]+)\]/i);
  if (urlMatch) {
    nodeType = "url";
    url = urlMatch[1].trim();
    title = title.replace(urlMatch[0], "").trim();
  }

  // [color:...]
  const colorBracket = title.match(/\[color:([^\]]+)\]/i);
  if (colorBracket) {
    color = parseColorSpec(colorBracket[1]);
    title = title.replace(colorBracket[0], "").trim();
  }

  // [scale:N]
  const scaleMatch = title.match(/\[scale:(-?\d+)\]/i);
  if (scaleMatch) {
    fontScaleLevel = Number.parseInt(scaleMatch[1], 10);
    title = title.replace(scaleMatch[0], "").trim();
  }

  // Trailing #tags: #blue, #green, #dashed, #solid, #none, #section
  const tagRegex = /\s+#(blue|green|red|yellow|purple|orange|cyan|gray|dashed|solid|none|noborder|section)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(title)) !== null) {
    const tag = match[1].toLowerCase();
    if (tag in SEMANTIC_COLORS) {
      color = { ...SEMANTIC_COLORS[tag] };
    } else if (tag === "dashed" || tag === "solid") {
      borderStyle = tag;
    } else if (tag === "none" || tag === "noborder") {
      borderStyle = "none";
    } else if (tag === "section") {
      nodeType = "section";
    }
  }
  title = title.replace(tagRegex, "").trim();

  return {
    cleanTitle: title || rawTitle.trim(),
    nodeType,
    url,
    color,
    borderStyle,
    fontScaleLevel,
  };
}

/**
 * Convert plain markdown text lines into PlateJS / Slate Value AST for Entity.details.
 */
export function markdownLinesToPlateDetails(lines: string[]): PlateValue {
  const trimmedLines = lines.map((l) => l.trimEnd());
  while (trimmedLines.length > 0 && trimmedLines[0].trim() === "") {
    trimmedLines.shift();
  }
  while (trimmedLines.length > 0 && trimmedLines[trimmedLines.length - 1].trim() === "") {
    trimmedLines.pop();
  }
  if (trimmedLines.length === 0) {
    return [];
  }

  const blocks: PlateBlock[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (const line of trimmedLines) {
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLang = fenceMatch[1] || "text";
        codeLines = [];
      } else {
        inCodeBlock = false;
        blocks.push({
          type: "code_block",
          lang: codeLang,
          children: codeLines.map((cl) => ({
            type: "code_line",
            children: [{ text: cl }],
          })),
        });
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    blocks.push({
      type: "p",
      children: [{ text: line }],
    });
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({
      type: "code_block",
      lang: codeLang,
      children: codeLines.map((cl) => ({
        type: "code_line",
        children: [{ text: cl }],
      })),
    });
  }

  return blocks;
}

/**
 * Parse inline edge syntax from a body line:
 *   -> Target Node : label
 *   ..> Target Node : dashed label
 *   ~> Target Node : arc label [arc:80]
 *   <-> Target Node : bidirectional label
 */
function tryParseInlineEdge(sourceTitle: string, line: string): InlineEdgeSpec[] | null {
  const trimmed = line.trim();
  const match = trimmed.match(/^(->|\.\.>|\~>|<->)\s+([^:]+?)(?:\s*:\s*(.+))?$/);
  if (!match) {
    return null;
  }

  const operator = match[1];
  const targetTitle = match[2].trim();
  let label = (match[3] ?? "").trim();

  let offset = 60;
  const arcMatch = label.match(/\[arc:(-?\d+)\]/i);
  if (arcMatch) {
    offset = Number.parseInt(arcMatch[1], 10);
    label = label.replace(arcMatch[0], "").trim();
  }

  let color: ColorRGBA | undefined;
  const colorTag = label.match(/#(blue|green|red|yellow|purple|orange|cyan|gray)\b/i);
  if (colorTag) {
    color = { ...SEMANTIC_COLORS[colorTag[1].toLowerCase()] };
    label = label.replace(colorTag[0], "").trim();
  }

  if (operator === "->") {
    return [{ from: sourceTitle, to: targetTitle, text: label, edgeType: "line", lineType: "solid", color }];
  }
  if (operator === "..>") {
    return [{ from: sourceTitle, to: targetTitle, text: label, edgeType: "line", lineType: "dashed", color }];
  }
  if (operator === "~>") {
    return [{ from: sourceTitle, to: targetTitle, text: label, edgeType: "arc", lineType: "solid", offset, color }];
  }
  if (operator === "<->") {
    return [
      { from: sourceTitle, to: targetTitle, text: label, edgeType: "arc", lineType: "solid", offset: 50, color },
      { from: targetTitle, to: sourceTitle, text: label, edgeType: "arc", lineType: "solid", offset: 50, color },
    ];
  }
  return null;
}

export function parseMarkdownDocument(markdown: string): ParsedMarkdownDocument {
  const lines = markdown.split("\n");
  const root: MarkdownNode[] = [];
  const stack: { node: MarkdownNode; level: number; bodyLines: string[] }[] = [];
  const allInlineEdges: InlineEdgeSpec[] = [];

  const finalizeNodeBody = (item: { node: MarkdownNode; bodyLines: string[] }) => {
    const detailLines: string[] = [];
    for (const line of item.bodyLines) {
      const edges = tryParseInlineEdge(item.node.title, line);
      if (edges) {
        item.node.inlineEdges.push(...edges);
        allInlineEdges.push(...edges);
      } else {
        detailLines.push(line);
      }
    }
    item.node.content = detailLines.join("\n").trim();
    item.node.details = markdownLinesToPlateDetails(detailLines);
  };

  let inFence = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inFence = !inFence;
    }

    const titleMatch = !inFence ? line.match(/^(#+)\s+(.*)/) : null;
    if (titleMatch) {
      const level = titleMatch[1].length;
      const rawTitle = titleMatch[2].trim();
      const directives = parseHeadingDirectives(rawTitle);

      const newNode: MarkdownNode = {
        title: directives.cleanTitle,
        rawTitle,
        content: "",
        details: [],
        nodeType: directives.nodeType,
        url: directives.url,
        color: directives.color,
        borderStyle: directives.borderStyle,
        fontScaleLevel: directives.fontScaleLevel,
        inlineEdges: [],
        children: [],
      };

      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        const popped = stack.pop()!;
        finalizeNodeBody(popped);
      }

      if (stack.length === 0) {
        root.push(newNode);
      } else {
        stack[stack.length - 1].node.children.push(newNode);
      }

      stack.push({ node: newNode, level, bodyLines: [] });
    } else {
      if (stack.length > 0) {
        stack[stack.length - 1].bodyLines.push(line);
      }
    }
  }

  while (stack.length > 0) {
    const popped = stack.pop()!;
    finalizeNodeBody(popped);
  }

  return { nodes: root, inlineEdges: allInlineEdges };
}

/**
 * Backward-compatible parser returning MarkdownNode[].
 */
export function parseMarkdownToJSON(markdown: string): MarkdownNode[] {
  return parseMarkdownDocument(markdown).nodes;
}
