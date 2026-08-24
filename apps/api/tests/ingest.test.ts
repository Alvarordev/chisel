import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "chisel-ingest-"));

const {
  createUploadPreview,
  detectMime,
  extractDocument,
  IngestError,
  promotePreviewToOriginal,
  readPreviewMeta,
} = await import("../src/core/documents/ingest.ts");

test("detects plaintext and rejects unknown binaries", () => {
  const text = new TextEncoder().encode("# Spec\n\nCrear la clase Prestamo.");
  expect(detectMime(text)).toBe("text/markdown");

  const garbage = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x11]);
  expect(detectMime(garbage)).toBeNull();
});

test("extracts markdown from text uploads and stores a preview", async () => {
  const markdown = "# Enunciado\n\nImplementar el endpoint de salud con criterio verificable.";
  const buffer = new TextEncoder().encode(markdown);
  const preview = await createUploadPreview({
    userId: "ingest-user",
    buffer,
    filename: "spec.md",
  });

  expect(preview.markdown).toContain("Implementar el endpoint");
  expect(preview.previewId).toBeTruthy();
  expect(readPreviewMeta("ingest-user", preview.previewId).originalName).toBe("spec.md");

  const promoted = promotePreviewToOriginal({
    userId: "ingest-user",
    previewId: preview.previewId,
    documentId: "doc-1",
  });
  expect(promoted.originalPath).toBe("originals/ingest-user/doc-1.md");
  expect(() => readPreviewMeta("ingest-user", preview.previewId)).toThrow(IngestError);
});

test("extractDocument returns empty warning for tiny text", async () => {
  const result = await extractDocument(new TextEncoder().encode("   "), "text/plain");
  expect(result.markdown).toBe("");
  expect(result.warnings.length).toBeGreaterThan(0);
});

test("createUploadPreview rejects oversized payloads", async () => {
  const huge = new Uint8Array(10 * 1024 * 1024 + 1);
  await expect(
    createUploadPreview({ userId: "ingest-user", buffer: huge, filename: "big.bin" }),
  ).rejects.toMatchObject({ status: 413, code: "FILE_TOO_LARGE" });
});
