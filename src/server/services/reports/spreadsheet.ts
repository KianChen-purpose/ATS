import "server-only";
import PizZip from "pizzip";
import { TZDate } from "@date-fns/tz";

/**
 * Minimal CSV and Excel (.xlsx, SpreadsheetML) writers for report exports. No dependency beyond
 * pizzip, which the offer letters already use. Strings go in as inline strings, so nothing in a cell
 * is ever evaluated as a formula; CSV cells that a spreadsheet would read as a formula are escaped.
 */

export type CellFormat = "int" | "decimal" | "percent" | "money" | "date";
export type Cell = string | number | null | Date | { value: number | null; format: CellFormat };
/** `tz`: show date cells as wall-clock time in this zone in Excel (CSV keeps ISO 8601 UTC). */
export type Table = { name: string; headers: string[]; rows: Cell[][]; title?: string; tz?: string };

const FORMULA_START = /^[=+\-@\t\r]/;

function plain(c: Cell): string {
  if (c == null) return "";
  if (c instanceof Date) return c.toISOString();
  if (typeof c === "object") {
    if (c.value == null) return "";
    if (c.format === "percent") return (Math.round(c.value * 10000) / 10000).toString();
    if (c.format === "money" || c.format === "int") return Math.round(c.value).toString();
    return (Math.round(c.value * 100) / 100).toString();
  }
  return String(c);
}

/** RFC 4180 CSV with a UTF-8 BOM (so Excel opens accents correctly). */
export function toCsv(t: Table): Buffer {
  const esc = (s: string, isText: boolean) => {
    // CSV injection: a leading =, +, -, @ makes Excel treat text as a formula.
    const safe = isText && FORMULA_START.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [t.headers.map((h) => esc(h, true)).join(","), ...t.rows.map((r) => r.map((c) => esc(plain(c), typeof c === "string")).join(","))];
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Characters XML 1.0 can't carry.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Style ids in styles.xml below. */
const STYLE = { header: 1, int: 2, decimal: 3, percent: 4, money: 5, date: 6, title: 7 } as const;

function cellXml(c: Cell, ref: string, tz?: string): string {
  if (c == null) return "";
  if (c instanceof Date) {
    // Excel serial date (days since 1899-12-30) of the local wall-clock time.
    const l = tz ? new TZDate(c.getTime(), tz) : null;
    const wall = l ? Date.UTC(l.getFullYear(), l.getMonth(), l.getDate(), l.getHours(), l.getMinutes(), l.getSeconds()) : c.getTime();
    const serial = wall / 86_400_000 + 25569;
    return `<c r="${ref}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  if (typeof c === "number") return `<c r="${ref}" s="${Number.isInteger(c) ? STYLE.int : STYLE.decimal}"><v>${c}</v></c>`;
  if (typeof c === "object") return c.value == null ? "" : `<c r="${ref}" s="${STYLE[c.format]}"><v>${c.value}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(c)}</t></is></c>`;
}

export function toXlsx(t: Table): Buffer {
  const offset = t.title ? 2 : 0;
  const rowsXml: string[] = [];
  if (t.title) rowsXml.push(`<row r="1"><c r="A1" t="inlineStr" s="${STYLE.title}"><is><t xml:space="preserve">${xml(t.title)}</t></is></c></row>`);
  const header = t.headers.map((h, i) => `<c r="${colName(i)}${offset + 1}" t="inlineStr" s="${STYLE.header}"><is><t xml:space="preserve">${xml(h)}</t></is></c>`).join("");
  rowsXml.push(`<row r="${offset + 1}">${header}</row>`);
  t.rows.forEach((r, ri) => {
    const n = offset + ri + 2;
    rowsXml.push(`<row r="${n}">${r.map((c, ci) => cellXml(c, `${colName(ci)}${n}`, t.tz)).join("")}</row>`);
  });
  const widths = t.headers.map((h, i) => {
    const longest = Math.max(h.length, ...t.rows.slice(0, 200).map((r) => plain(r[i] ?? null).length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`;
  });
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${offset + 1}" topLeftCell="A${offset + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.join("")}</cols><sheetData>${rowsXml.join("")}</sheetData></worksheet>`;
  const sheetName = xml(t.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Report");

  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  zip.file("xl/worksheets/sheet1.xml", sheet);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

export const EXPORT_TYPES = {
  csv: { contentType: "text/csv; charset=utf-8", ext: "csv" },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx" },
} as const;
export type ExportFormat = keyof typeof EXPORT_TYPES;

export function renderTable(t: Table, format: ExportFormat) {
  return format === "csv" ? toCsv(t) : toXlsx(t);
}
