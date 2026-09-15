import { readFile, writeFile } from "node:fs/promises";
import { decode } from "@msgpack/msgpack";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

interface ParsedPrgArchive {
  stage: any[];
  tags: string[];
  references: any;
  metadata: any;
  readme?: string;
  attachments: string[];
}

async function readPrgArchive(filePath: string): Promise<ParsedPrgArchive> {
  const buf = new Uint8Array(await readFile(filePath));
  const reader = new ZipReader(new Uint8ArrayReader(buf));
  const entries = await reader.getEntries();

  let stage: any[] = [];
  let tags: string[] = [];
  let references: any = {};
  let metadata: any = {};
  let readme: string | undefined;
  const attachments: string[] = [];

  for (const e of entries) {
    if (e.directory) continue;
    if (e.filename === "stage.msgpack") {
      stage = decode(await e.getData!(new Uint8ArrayWriter())) as any[];
    } else if (e.filename === "tags.msgpack") {
      tags = decode(await e.getData!(new Uint8ArrayWriter())) as string[];
    } else if (e.filename === "reference.msgpack") {
      references = decode(await e.getData!(new Uint8ArrayWriter()));
    } else if (e.filename === "metadata.msgpack") {
      metadata = decode(await e.getData!(new Uint8ArrayWriter()));
    } else if (e.filename === "README.md") {
      readme = new TextDecoder().decode(await e.getData!(new Uint8ArrayWriter()));
    } else if (e.filename.startsWith("attachments/")) {
      attachments.push(e.filename);
    }
  }

  await reader.close();
  return { stage, tags, references, metadata, readme, attachments };
}

function getByPath(root: any, refPath: string): any {
  const parts = refPath.split("/").filter(Boolean);
  let cur = root;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function replaceRefsInStage(stage: any[]): any[] {
  // Deep clone first so we can resolve $ pointers
  const cloned = JSON.parse(JSON.stringify(stage));
  const resolveObj = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(resolveObj);
    }
    if (obj && typeof obj === "object") {
      if ("$" in obj && typeof obj.$ === "string") {
        return getByPath(cloned, obj.$) ?? obj;
      }
      for (const k of Object.keys(obj)) {
        obj[k] = resolveObj(obj[k]);
      }
    }
    return obj;
  };
  return resolveObj(cloned);
}

function validateStage(archive: ParsedPrgArchive): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const version = archive.metadata?.version;
  if (!version) {
    errors.push("Missing metadata.version");
  } else if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    warnings.push(
      `metadata.version is "${version}" (legacy format). Recommended SemVer is "2.7.0" so ProjectUpgrader runs properly.`,
    );
  }

  const uuids = new Set<string>();

  const checkPositionalKeys = (obj: any, pathStr: string) => {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach((item, idx) => checkPositionalKeys(item, `${pathStr}/${idx}`));
      return;
    }
    if ("$" in obj && typeof obj.$ === "string") {
      const target = getByPath(archive.stage, obj.$);
      if (target === undefined) {
        errors.push(`Broken $ reference at ${pathStr}: "${obj.$}" does not resolve.`);
      }
      return;
    }

    const cls = obj._;
    const keys = Object.keys(obj).filter((k) => k !== "_");

    if (cls === "Vector") {
      if (keys[0] !== "x" || keys[1] !== "y") {
        errors.push(`Invalid Vector key order at ${pathStr}: expected ["x","y"], got ${JSON.stringify(keys)}`);
      }
    } else if (cls === "Color") {
      if (keys[0] !== "r" || keys[1] !== "g" || keys[2] !== "b" || keys[3] !== "a") {
        errors.push(
          `Invalid Color key order at ${pathStr}: expected ["r","g","b","a"], got ${JSON.stringify(keys)}`,
        );
      }
    } else if (cls === "Rectangle") {
      if (keys[0] !== "location" || keys[1] !== "size") {
        errors.push(
          `Invalid Rectangle key order at ${pathStr}: expected ["location","size"], got ${JSON.stringify(keys)}`,
        );
      }
    }

    if (typeof obj.uuid === "string") {
      if (uuids.has(obj.uuid)) {
        warnings.push(`Duplicate UUID found at ${pathStr}: ${obj.uuid}`);
      }
      uuids.add(obj.uuid);
    }

    for (const k of Object.keys(obj)) {
      if (k !== "_") checkPositionalKeys(obj[k], `${pathStr}/${k}`);
    }
  };

  archive.stage.forEach((item, idx) => checkPositionalKeys(item, `/${idx}`));

  return { valid: errors.length === 0, errors, warnings };
}

function plateDetailsToMarkdownText(details: any): string {
  if (!Array.isArray(details) || details.length === 0) return "";
  const lines: string[] = [];
  for (const block of details) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "code_block") {
      lines.push(`\`\`\`${block.lang ?? ""}`);
      for (const cl of block.children ?? []) {
        const text = (cl.children ?? []).map((leaf: any) => leaf.text ?? "").join("");
        lines.push(text);
      }
      lines.push("```");
    } else {
      const text = (block.children ?? []).map((leaf: any) => leaf.text ?? "").join("");
      if (text.trim()) lines.push(text);
    }
  }
  return lines.join("\n");
}

function stageToMarkdown(archive: ParsedPrgArchive): string {
  const resolved = replaceRefsInStage(archive.stage);

  // Deduplicate entities by UUID
  const entitiesByUuid = new Map<string, any>();
  const edges: any[] = [];

  const collect = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    const cls = obj._;
    if (cls === "LineEdge" || cls === "ArcEdge" || cls === "MultiTargetUndirectedEdge") {
      edges.push(obj);
      return;
    }
    if (obj.uuid && cls) {
      if (!entitiesByUuid.has(obj.uuid)) {
        entitiesByUuid.set(obj.uuid, obj);
      }
      if (cls === "Section" && Array.isArray(obj.children)) {
        for (const c of obj.children) collect(c);
      }
    }
  };

  for (const item of resolved) collect(item);

  // Determine parent Section or tree parent for each entity
  const childToParentUuid = new Map<string, string>();
  for (const [uuid, ent] of entitiesByUuid) {
    if (ent._ === "Section" && Array.isArray(ent.children)) {
      for (const c of ent.children) {
        if (c?.uuid) childToParentUuid.set(c.uuid, uuid);
      }
    }
  }

  // Classify edges into tree edges vs extra edges
  const treeChildrenByUuid = new Map<string, string[]>();
  const extraEdges: Array<{ from: string; to: string; text: string; isArc: boolean }> = [];

  for (const edge of edges) {
    const src = edge.associationList?.[0];
    const tgt = edge.associationList?.[1];
    if (!src?.uuid || !tgt?.uuid) continue;
    const srcEnt = entitiesByUuid.get(src.uuid);
    const tgtEnt = entitiesByUuid.get(tgt.uuid);
    if (!srcEnt || !tgtEnt) continue;

    const srcTitle = srcEnt.text || srcEnt.title || srcEnt.latexSource || srcEnt.uuid;
    const tgtTitle = tgtEnt.text || tgtEnt.title || tgtEnt.latexSource || tgtEnt.uuid;

    // If target doesn't already have a parent and isn't an ancestor, treat unlabelled right-to-left edge as tree edge
    const isTreeRate =
      edge._ === "LineEdge" &&
      !edge.text &&
      Math.abs((edge.sourceRectangleRate?.x ?? 0.5) - 0.99) < 0.05 &&
      Math.abs((edge.targetRectangleRate?.x ?? 0.5) - 0.01) < 0.05;

    if (isTreeRate && !childToParentUuid.has(tgt.uuid)) {
      childToParentUuid.set(tgt.uuid, src.uuid);
      if (!treeChildrenByUuid.has(src.uuid)) treeChildrenByUuid.set(src.uuid, []);
      treeChildrenByUuid.get(src.uuid)!.push(tgt.uuid);
    } else {
      extraEdges.push({
        from: srcTitle,
        to: tgtTitle,
        text: edge.text ?? "",
        isArc: edge._ === "ArcEdge",
      });
    }
  }

  // Find root entities
  const roots: string[] = [];
  for (const [uuid] of entitiesByUuid) {
    if (!childToParentUuid.has(uuid)) {
      roots.push(uuid);
    }
  }

  const mdLines: string[] = [];
  const emitted = new Set<string>();

  const emitEntity = (uuid: string, depth: number) => {
    if (emitted.has(uuid)) return;
    emitted.add(uuid);
    const ent = entitiesByUuid.get(uuid);
    if (!ent) return;

    const hashes = "#".repeat(Math.min(depth, 6));
    let prefix = "";
    if (ent._ === "Section") prefix = "[section] ";
    else if (ent._ === "UrlNode") prefix = `[url:${ent.url ?? ""}] `;
    else if (ent._ === "LatexNode") prefix = "[latex] ";

    const title = ent.text || ent.title || ent.latexSource || ent.uuid;
    mdLines.push(`${hashes} ${prefix}${title}`);

    const detailsText = plateDetailsToMarkdownText(ent.details);
    if (detailsText) {
      mdLines.push(detailsText);
    }

    // Inline extra edges originating from this node
    for (const edge of extraEdges.filter((e) => e.from === title)) {
      const op = edge.isArc ? "~>" : "->";
      const lbl = edge.text ? ` : ${edge.text}` : "";
      mdLines.push(`${op} ${edge.to}${lbl}`);
    }

    mdLines.push("");

    // Emit Section children first, then tree children
    if (ent._ === "Section" && Array.isArray(ent.children)) {
      for (const c of ent.children) {
        if (c?.uuid) emitEntity(c.uuid, depth + 1);
      }
    }
    for (const childUuid of treeChildrenByUuid.get(uuid) ?? []) {
      emitEntity(childUuid, depth + 1);
    }
  };

  for (const rootUuid of roots) {
    emitEntity(rootUuid, 1);
  }

  return mdLines.join("\n");
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: npx tsx prg-inspect.ts <command> <file.prg> [options]",
      "",
      "Commands:",
      "  summary <file.prg>              Print metadata, object counts by class, and validation status",
      "  validate <file.prg>             Run strict v2.7.0 schema and reference integrity checks",
      "  to-md <file.prg> [-o out.md]    Reverse-compile a .prg file into Markdown DSL (for AI reading/editing)",
      "",
    ].join("\n"),
  );
}

async function run(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv.includes("-h") || argv.includes("--help")) {
    printUsage();
    process.exit(argv.length < 2 ? 1 : 0);
  }

  const command = argv[0];
  const filePath = argv[1];
  const archive = await readPrgArchive(filePath);

  if (command === "summary") {
    const counts: Record<string, number> = {};
    for (const obj of archive.stage) {
      const cls = obj?._ ?? ("$" in (obj ?? {}) ? "$Ref" : "Unknown");
      counts[cls] = (counts[cls] ?? 0) + 1;
    }
    const validation = validateStage(archive);
    console.log(
      JSON.stringify(
        {
          file: filePath,
          version: archive.metadata?.version ?? "unknown",
          totalStageEntries: archive.stage.length,
          classCounts: counts,
          tags: archive.tags,
          attachmentCount: archive.attachments.length,
          hasReadme: Boolean(archive.readme),
          valid: validation.valid,
          errorCount: validation.errors.length,
          warningCount: validation.warnings.length,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "validate") {
    const validation = validateStage(archive);
    console.log(JSON.stringify(validation, null, 2));
    if (!validation.valid) process.exitCode = 1;
    return;
  }

  if (command === "to-md") {
    const md = stageToMarkdown(archive);
    const outIdx = argv.findIndex((a) => a === "-o" || a === "--output");
    if (outIdx !== -1 && argv[outIdx + 1]) {
      await writeFile(argv[outIdx + 1], md, "utf8");
      console.log(`Wrote ${argv[outIdx + 1]}`);
    } else {
      process.stdout.write(md);
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

run().catch((err) => {
  process.stderr.write(`prg-inspect error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
