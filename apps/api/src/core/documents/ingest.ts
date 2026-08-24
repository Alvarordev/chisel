import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { dataDir } from "../../db/system.ts";

const MAX_BYTES = 10 * 1024 * 1024;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export type DetectedMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "text/plain"
  | "text/markdown";

export type ExtractResult = {
  markdown: string;
  warnings: string[];
  pageCount?: number;
  needsOcr?: boolean;
};

export type IngestPreview = {
  previewId: string;
  markdown: string;
  warnings: string[];
  originalName: string;
  mime: DetectedMime;
  extension: string;
};

export class IngestError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 413 | 415 | 422 | 404,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

type PreviewMeta = {
  previewId: string;
  userId: string;
  originalName: string;
  mime: DetectedMime;
  extension: string;
  markdown: string;
  warnings: string[];
  createdAt: string;
};

function previewsRoot(userId: string): string {
  const dir = join(dataDir(), "previews", userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function originalsRoot(userId: string): string {
  const dir = join(dataDir(), "originals", userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function previewDir(userId: string, previewId: string): string {
  return join(previewsRoot(userId), previewId);
}

export function detectMime(buffer: Uint8Array): DetectedMime | null {
  if (buffer.length >= 5 && buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return "application/pdf";
  }
  // ZIP / DOCX: PK..
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)) {
    const head = Buffer.from(buffer.slice(0, Math.min(buffer.length, 8192))).toString("binary");
    if (head.includes("word/") || head.includes("[Content_Types].xml")) {
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  }
  // Heuristic text
  const sample = buffer.slice(0, Math.min(buffer.length, 512));
  let printable = 0;
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 192) printable += 1;
  }
  if (sample.length > 0 && printable / sample.length > 0.9) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(sample).trimStart();
    if (text.startsWith("#") || text.includes("\n#")) return "text/markdown";
    return "text/plain";
  }
  return null;
}

function extensionForMime(mime: DetectedMime): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "text/markdown") return "md";
  return "txt";
}

function usefulCharCount(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}

async function extractPdf(buffer: Uint8Array): Promise<ExtractResult> {
  const pdf = await getDocumentProxy(buffer);
  const pageCount = typeof pdf.numPages === "number" ? pdf.numPages : undefined;
  const { text } = await extractText(pdf, { mergePages: true });
  const markdown = Array.isArray(text) ? text.join("\n\n") : String(text ?? "");
  const chars = usefulCharCount(markdown);
  const warnings: string[] = [];

  if (chars < 100 && (pageCount ?? 1) > 1) {
    return {
      markdown: "",
      warnings: [
        "Parece escaneado o sin capa de texto. Pegá el contenido a mano o esperá OCR (Fase B).",
      ],
      pageCount,
      needsOcr: true,
    };
  }
  if (chars < 40) {
    return {
      markdown: "",
      warnings: ["La extracción del PDF quedó vacía o casi vacía."],
      pageCount,
      needsOcr: chars === 0,
    };
  }
  if (chars > 8000) {
    warnings.push("Documento largo: conviene agregar un summary antes de planificar.");
  }
  return { markdown: markdown.trim(), warnings, pageCount };
}

async function extractDocx(buffer: Uint8Array): Promise<ExtractResult> {
  const mammothMarkdown = mammoth as unknown as {
    convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }>;
  };
  const { value } = await mammothMarkdown.convertToMarkdown({ buffer: Buffer.from(buffer) });
  const markdown = value.trim();
  if (usefulCharCount(markdown) < 40) {
    return { markdown: "", warnings: ["La extracción del DOCX quedó vacía o casi vacía."] };
  }
  const warnings: string[] = [];
  if (usefulCharCount(markdown) > 8000) {
    warnings.push("Documento largo: conviene agregar un summary antes de planificar.");
  }
  return { markdown, warnings };
}

function extractTextFile(buffer: Uint8Array): ExtractResult {
  const markdown = new TextDecoder("utf-8", { fatal: false }).decode(buffer).trim();
  if (usefulCharCount(markdown) < 1) {
    return { markdown: "", warnings: ["El archivo de texto está vacío."] };
  }
  return { markdown, warnings: [] };
}

export async function extractDocument(buffer: Uint8Array, mime: DetectedMime): Promise<ExtractResult> {
  if (mime === "application/pdf") return extractPdf(buffer);
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocx(buffer);
  }
  return extractTextFile(buffer);
}

function cleanupExpiredPreviews(userId: string): void {
  const root = previewsRoot(userId);
  try {
    for (const name of readdirSync(root)) {
      const metaPath = join(root, name, "meta.json");
      if (!existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as PreviewMeta;
        if (Date.now() - Date.parse(meta.createdAt) > PREVIEW_TTL_MS) {
          rmSync(join(root, name), { recursive: true, force: true });
        }
      } catch {
        // ignore corrupt preview
      }
    }
  } catch {
    // ignore
  }
}

export async function createUploadPreview(input: {
  userId: string;
  buffer: Uint8Array;
  filename: string;
}): Promise<IngestPreview> {
  if (input.buffer.byteLength > MAX_BYTES) {
    throw new IngestError("El archivo supera 10 MB.", 413, "FILE_TOO_LARGE");
  }

  const mime = detectMime(input.buffer);
  if (!mime) {
    throw new IngestError(
      "Formato no soportado. Aceptamos PDF, DOCX, Markdown y texto plano.",
      415,
      "UNSUPPORTED_TYPE",
    );
  }

  const extracted = await extractDocument(input.buffer, mime);
  if (extracted.needsOcr) {
    throw new IngestError(extracted.warnings[0] ?? "Se requiere OCR.", 422, "NEEDS_OCR");
  }
  if (!extracted.markdown.trim()) {
    throw new IngestError(extracted.warnings[0] ?? "Extracción vacía.", 422, "EMPTY_EXTRACTION");
  }

  cleanupExpiredPreviews(input.userId);

  const previewId = crypto.randomUUID();
  const extension = extensionForMime(mime);
  const dir = previewDir(input.userId, previewId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `original.${extension}`), input.buffer);
  const meta: PreviewMeta = {
    previewId,
    userId: input.userId,
    originalName: input.filename,
    mime,
    extension,
    markdown: extracted.markdown,
    warnings: extracted.warnings,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(meta, null, 2));

  return {
    previewId,
    markdown: extracted.markdown,
    warnings: extracted.warnings,
    originalName: input.filename,
    mime,
    extension,
  };
}

export function readPreviewMeta(userId: string, previewId: string): PreviewMeta {
  const metaPath = join(previewDir(userId, previewId), "meta.json");
  if (!existsSync(metaPath)) {
    throw new IngestError("Preview no encontrado o expirado.", 404, "PREVIEW_NOT_FOUND");
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as PreviewMeta;
  if (meta.userId !== userId) {
    throw new IngestError("Preview no encontrado o expirado.", 404, "PREVIEW_NOT_FOUND");
  }
  if (Date.now() - Date.parse(meta.createdAt) > PREVIEW_TTL_MS) {
    rmSync(previewDir(userId, previewId), { recursive: true, force: true });
    throw new IngestError("Preview no encontrado o expirado.", 404, "PREVIEW_NOT_FOUND");
  }
  return meta;
}

export function promotePreviewToOriginal(input: {
  userId: string;
  previewId: string;
  documentId: string;
}): { originalPath: string; originalName: string } {
  const meta = readPreviewMeta(input.userId, input.previewId);
  const from = join(previewDir(input.userId, input.previewId), `original.${meta.extension}`);
  const originalPath = join("originals", input.userId, `${input.documentId}.${meta.extension}`);
  const to = join(dataDir(), originalPath);
  mkdirSync(originalsRoot(input.userId), { recursive: true });
  renameSync(from, to);
  rmSync(previewDir(input.userId, input.previewId), { recursive: true, force: true });
  return { originalPath, originalName: meta.originalName };
}

export function discardPreview(userId: string, previewId: string): void {
  const dir = previewDir(userId, previewId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
