/**
 * Turns a document into pages of positioned text lines.
 *   PDF, Azure:  Azure AI Document Intelligence (prebuilt-layout)
 *   PDF, local:  pdf.js text layer
 *   DOCX/TXT:    plain text, laid out on A4 pages
 */
import type { LayoutLine, LayoutPage } from '@vm/domain';
import { config } from '../config';

export interface ReadResult {
  pages: LayoutPage[];
  service: string;
}

const A4 = { width: 595, height: 842, margin: 56, lineHeight: 15, fontSize: 10.5 };

export function layoutPlainText(text: string): LayoutPage[] {
  const maxChars = 92;
  const wrapped: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) {
      wrapped.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxChars) {
        wrapped.push(line.trim());
        line = w;
      } else line += ' ' + w;
    }
    if (line.trim()) wrapped.push(line.trim());
  }
  const perPage = Math.floor((A4.height - 2 * A4.margin) / A4.lineHeight);
  const pages: LayoutPage[] = [];
  for (let i = 0; i < wrapped.length; i += perPage) {
    const chunk = wrapped.slice(i, i + perPage);
    const lines: LayoutLine[] = [];
    chunk.forEach((t, j) => {
      if (!t) return;
      lines.push({ text: t, box: [A4.margin, A4.margin + j * A4.lineHeight, Math.min(t.length * 5.1, A4.width - 2 * A4.margin), A4.fontSize + 2] });
    });
    pages.push({ width: A4.width, height: A4.height, lines });
  }
  return pages.length ? pages : [{ width: A4.width, height: A4.height, lines: [] }];
}

async function readPdfLocal(bytes: Uint8Array): Promise<LayoutPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true }).promise;
  const pages: LayoutPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    type Item = { str: string; x: number; y: number; w: number; h: number };
    const items: Item[] = [];
    for (const it of content.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str || !it.transform) continue;
      const [, , c, d, e, f] = it.transform;
      const h = it.height || Math.hypot(c, d) || 10;
      items.push({ str: it.str, x: e, y: vp.height - f - h, w: it.width ?? it.str.length * h * 0.5, h });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines: LayoutLine[] = [];
    let cur: Item[] = [];
    const flush = () => {
      if (!cur.length) return;
      cur.sort((a, b) => a.x - b.x);
      let text = '';
      let lastEnd = -Infinity;
      for (const it of cur) {
        const gap = it.x - lastEnd;
        if (text && gap > it.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) text += ' ';
        text += it.str;
        lastEnd = it.x + it.w;
      }
      const x = Math.min(...cur.map((i) => i.x));
      const y = Math.min(...cur.map((i) => i.y));
      const right = Math.max(...cur.map((i) => i.x + i.w));
      const bottom = Math.max(...cur.map((i) => i.y + i.h));
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean) lines.push({ text: clean, box: [x, y, right - x, bottom - y] });
      cur = [];
    };
    for (const it of items) {
      if (cur.length && Math.abs(it.y - cur[0].y) > cur[0].h * 0.5) flush();
      cur.push(it);
    }
    flush();
    pages.push({ width: vp.width, height: vp.height, lines });
  }
  return pages;
}

async function readWithDocumentIntelligence(bytes: Uint8Array): Promise<LayoutPage[]> {
  const { default: DocumentIntelligence, getLongRunningPoller, isUnexpected } = await import('@azure-rest/ai-document-intelligence');
  const { DefaultAzureCredential } = await import('@azure/identity');
  const client = DocumentIntelligence(config.ai.docIntelEndpoint!, new DefaultAzureCredential());
  const initial = await client
    .path('/documentModels/{modelId}:analyze', 'prebuilt-layout')
    .post({ contentType: 'application/json', body: { base64Source: Buffer.from(bytes).toString('base64') } });
  if (isUnexpected(initial)) throw new Error(initial.body.error?.message ?? 'Document Intelligence Fehler');
  const poller = getLongRunningPoller(client, initial);
  const done = (await poller.pollUntilDone()) as { body: { analyzeResult?: { pages?: { width?: number; height?: number; unit?: string; lines?: { content: string; polygon?: number[] }[] }[] } } };
  const pages = done.body.analyzeResult?.pages ?? [];
  return pages.map((p) => {
    const k = p.unit === 'inch' ? 72 : 1;
    return {
      width: (p.width ?? 8.27) * k,
      height: (p.height ?? 11.69) * k,
      lines: (p.lines ?? []).map((l) => {
        const xs = (l.polygon ?? []).filter((_, i) => i % 2 === 0);
        const ys = (l.polygon ?? []).filter((_, i) => i % 2 === 1);
        const x = Math.min(...xs) * k;
        const y = Math.min(...ys) * k;
        return { text: l.content, box: [x, y, Math.max(...xs) * k - x, Math.max(...ys) * k - y] as [number, number, number, number] };
      }),
    };
  });
}

export async function readDocument(bytes: Uint8Array, fileName: string): Promise<ReadResult> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    if (config.ai.provider === 'azure' && config.ai.docIntelEndpoint) {
      return { pages: await readWithDocumentIntelligence(bytes), service: 'Azure AI Document Intelligence' };
    }
    return { pages: await readPdfLocal(bytes), service: 'pdf.js Textebene' };
  }
  if (lower.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { pages: layoutPlainText(value), service: 'Word-Dokument' };
  }
  return { pages: layoutPlainText(Buffer.from(bytes).toString('utf8')), service: 'Text' };
}

export function allLines(pages: LayoutPage[]): { page: number; line: number; text: string }[] {
  return pages.flatMap((p, pi) => p.lines.map((l, li) => ({ page: pi, line: li, text: l.text })));
}
