/**
 * Simple text PDFs for the demo data (sample contracts, supplier papers,
 * archived contracts). Real PDFs, so the readers run on them for real.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Characters outside WinAnsi that Helvetica cannot encode.
function safe(t: string) {
  return t.replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/[  ]/g, ' ').replace(/[^\x20-\x7e -ÿ’‘“”«»–—…€]/g, '');
}

export async function textPdf(opts: { title: string; subtitle?: string; paragraphs: { heading?: string; text: string }[]; footer?: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(opts.title);
  pdf.setProducer('Vertragsmanagement LLV (Demodaten)');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595;
  const H = 842;
  const M = 64;
  const size = 10.5;
  const lh = 15;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const write = (text: string, f = font, s = size, color = rgb(0.1, 0.1, 0.12)) => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    let line = '';
    const flush = () => {
      if (!line) return;
      if (y < M) newPage();
      page.drawText(line, { x: M, y, size: s, font: f, color });
      y -= s === size ? lh : s * 1.45;
      line = '';
    };
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, s) > W - 2 * M) {
        flush();
        line = w;
      } else line = next;
    }
    flush();
  };
  write(opts.title, bold, 15);
  if (opts.subtitle) write(opts.subtitle, font, 10, rgb(0.35, 0.35, 0.4));
  y -= 10;
  for (const p of opts.paragraphs) {
    if (p.heading) {
      y -= 4;
      write(p.heading, bold, size);
    }
    write(p.text);
    y -= 6;
  }
  if (opts.footer) {
    y -= 12;
    write(opts.footer, font, 9, rgb(0.4, 0.4, 0.45));
  }
  return pdf.save();
}
