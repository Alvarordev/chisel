# Spec — Ingesta de documentos

**Proyecto:** Chisel Planner  
**Documento padre:** `spec-tecnico.md` §6  
**Versión:** 1.0  
**Fecha:** agosto 2026  

---

## 1. Objetivo

Permitir cargar el `spec` o `approach` de un proyecto desde archivo (PDF/DOCX) o imagen, con **preview editable** antes de persistir. El agente solo consume markdown en SQLite; los binarios quedan en disco para re-extracción.

## 2. Almacenamiento

| Artefacto | Ubicación |
|---|---|
| Markdown definitivo | SQLite `documents.content` (`/data/users/{userId}.db`) |
| Original confirmado | `/data/originals/{userId}/{documentId}.{ext}` |
| Preview pendiente | `/data/previews/{userId}/{previewId}/` (original + `meta.json`) |
| Metadatos | `documents.original_path`, `original_name`, `source`, `summary` |

El agente **nunca** recibe el binario. `DATA_DIR` (volumen Docker) es el único persistente.

## 3. Pipeline

```
upload (multipart)
  → magic bytes (no extensión)
  → tamaño ≤ 10 MB
  → extractores por tipo
  → validar resultado
  → guardar preview en /data/previews/...
  → devolver markdown + warnings (NO persiste en documents)

confirmar (usuario revisa/corrige)
  → mover original a /data/originals/...
  → UPSERT documents (content, original_*, source=upload)
  → borrar preview
```

## 4. Fases

### Fase A — Texto digital (este corte)

| Formato | Extractor | Notas |
|---|---|---|
| PDF con capa de texto | `unpdf` | Sin dependencias nativas |
| DOCX | `mammoth` → markdown | |
| Pegado manual | textarea web / `set_document` MCP | `source=paste` o `agent` |

**Detección de PDF escaneado (Fase A):** texto útil &lt; 100 caracteres y más de 1 página → error claro: *"Parece escaneado o sin capa de texto. Pegá el contenido a mano o esperá OCR (Fase B)."* No se inventa contenido.

### Fase B — OCR local (planificado, no implementado)

| Formato | Proveedor |
|---|---|
| PDF sin texto / escaneado | Render páginas → Tesseract |
| PNG / JPEG / WebP | Tesseract directo |

- Motor: **Tesseract** local (`spa+eng`), CLI o binding.
- Interfaz: `OcrProvider.extract(buffer, mime) → { text, confidence?, warnings[] }`.
- Jobs async si el documento supera N páginas (cola en proceso o tabla `ingest_jobs`).
- Docker: instalar `tesseract-ocr` + packs de idioma en la imagen runtime.
- Manuscrito: calidad limitada; el preview sigue siendo obligatorio.
- Fuera de Fase B: cloud Vision/Textract, LLM multimodal.

## 5. Interfaz de extractores

```ts
type ExtractResult = {
  markdown: string
  warnings: string[]
  pageCount?: number
  needsOcr?: boolean
}

interface DocumentExtractor {
  supports(mime: string): boolean
  extract(buffer: Uint8Array): Promise<ExtractResult>
}

interface OcrProvider {  // Fase B
  extract(buffer: Uint8Array, mime: string): Promise<ExtractResult>
}
```

Fase A registra extractores PDF y DOCX. Si `needsOcr`, la API responde 422 con código `NEEDS_OCR` (hoy: mensaje de fallo; mañana: encola Tesseract).

## 6. API REST

| Método | Ruta | Efecto |
|---|---|---|
| `POST` | `/api/projects/:id/documents/upload` | multipart `file` + field `type` → preview |
| `POST` | `/api/projects/:id/documents` | `{ type, content, summary?, previewId? }` → persiste |

Respuesta upload:

```json
{
  "previewId": "...",
  "type": "spec",
  "markdown": "...",
  "warnings": [],
  "originalName": "enunciado.pdf"
}
```

## 7. Web

En el detalle de proyecto: subir PDF/DOCX por tipo, editar preview en el textarea, confirmar. El pegado manual sigue disponible.

## 8. MCP

Sin upload binario en v1. El agente sigue usando `set_document` con markdown. La web es la vía preferida para archivos.

## 9. Límites y fallos

| Caso | Respuesta |
|---|---|
| &gt; 10 MB | 413 |
| MIME no soportado | 415 + lista aceptada |
| PDF escaneado (Fase A) | 422 `NEEDS_OCR` |
| Extracción vacía | 422 |
| Preview expirado / inexistente | 404 |

TTL de previews: 24 h; cleanup oportunista al confirmar o al crear uno nuevo.

## 10. Criterios de éxito Fase A

1. Subir un PDF digital produce preview editable y, al confirmar, aparece en `get_project_context`.
2. El original queda en `/data/originals/...` y `original_path` en la fila.
3. Un PDF sin texto no inventa contenido; muestra el aviso de escaneado.
4. DOCX produce markdown usable en el textarea.
