/**
 * Minimal .xlsx writer for report downloads (docs/PLAN.md §9). No dependency: an .xlsx file is a zip of
 * a few XML files. Supports what reports need: a title block, a bold header row with filter and freeze,
 * column widths, a few cell styles, landscape fit-to-width printing with the header repeated.
 *
 * Text is always written as inline text (never a formula), so a name like "=SUM(...)" can't run.
 */
import { crc32, deflateRawSync } from "node:zlib";

export type CellStyle = "bold" | "muted" | "pct" | "red" | "pctRed" | "center" | "centerRed" | "centerMuted";
export type CellValue = string | number | null | undefined;
export type Cell = CellValue | { value: CellValue; style?: CellStyle };

export interface Sheet {
  /** Tab name; cleaned and cut to Excel's 31 characters. */
  name: string;
  title: string;
  /** Lines under the title (filters, date range, rules). */
  notes?: string[];
  header: string[];
  rows: Cell[][];
  /** Column widths in characters; missing ones are guessed from the content. */
  widths?: number[];
  /** Columns kept visible when scrolling right (e.g. roll + name). */
  freezeCols?: number;
  /** Lines after the data (legend). */
  footer?: string[];
}

const STYLE_ID: Record<CellStyle | "default" | "header" | "title", number> = {
  default: 0,
  header: 1,
  title: 2,
  muted: 3,
  pct: 4,
  red: 5,
  pctRed: 6,
  bold: 7,
  center: 8,
  centerRed: 9,
  centerMuted: 10,
};

const MAX_TEXT = 32_767;

/** Escape for XML text and drop characters XML 1.0 forbids. */
export function xmlText(s: string): string {
  return s
    .slice(0, MAX_TEXT)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Excel tab names: max 31 chars, none of : \ / ? * [ ], unique (case-insensitive), not blank. */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = raw.replace(/[:\\/?*[\]]/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function cellXml(ref: string, cell: Cell, fallbackStyle = 0): string {
  const { value, style } = cell !== null && typeof cell === "object" ? cell : { value: cell, style: undefined };
  const s = style ? STYLE_ID[style] : fallbackStyle;
  const sAttr = s ? ` s="${s}"` : "";
  if (value === null || value === undefined || value === "") return s ? `<c r="${ref}"${sAttr}/>` : "";
  if (typeof value === "number") return Number.isFinite(value) ? `<c r="${ref}"${sAttr}><v>${value}</v></c>` : "";
  return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

const textOf = (c: Cell) => String((c !== null && typeof c === "object" ? c.value : c) ?? "");

function sheetXml(sheet: Sheet): { xml: string; headerRow: number; lastRow: number } {
  const rows: string[] = [];
  let r = 0;
  const addRow = (cells: string[], height?: number) => {
    r++;
    rows.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ""}>${cells.join("")}</row>`);
  };
  addRow([cellXml(`A${r + 1}`, sheet.title, STYLE_ID.title)]);
  for (const n of sheet.notes ?? []) addRow([cellXml(`A${r + 1}`, n, STYLE_ID.muted)]);
  r++; // blank line
  const headerRow = r + 1;
  const wrapped = sheet.header.some((h) => h.includes("\n"));
  addRow(
    sheet.header.map((h, i) => cellXml(`${columnName(i)}${headerRow}`, h, STYLE_ID.header)),
    wrapped ? 15 * Math.min(4, Math.max(...sheet.header.map((h) => h.split("\n").length))) : undefined,
  );
  for (const row of sheet.rows) addRow(row.map((c, i) => cellXml(`${columnName(i)}${r + 1}`, c)));
  const lastRow = r;
  if (sheet.footer?.length) {
    r++;
    for (const f of sheet.footer) addRow([cellXml(`A${r + 1}`, f, STYLE_ID.muted)]);
  }

  const ncols = Math.max(1, sheet.header.length);
  const widths = Array.from({ length: ncols }, (_, i) => {
    if (sheet.widths?.[i]) return sheet.widths[i];
    const longest = Math.max(...sheet.header[i].split("\n").map((l) => l.length), ...sheet.rows.slice(0, 500).map((row) => textOf(row[i]).length));
    return Math.min(50, Math.max(4, longest + 2));
  });
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

  const xSplit = sheet.freezeCols ?? 0;
  const topLeft = `${columnName(xSplit)}${headerRow + 1}`;
  const pane = `<pane${xSplit ? ` xSplit="${xSplit}"` : ""} ySplit="${headerRow}" topLeftCell="${topLeft}" activePane="${xSplit ? "bottomRight" : "bottomLeft"}" state="frozen"/>`;
  const lastCol = columnName(ncols - 1);
  const filter = sheet.rows.length ? `<autoFilter ref="A${headerRow}:${lastCol}${lastRow}"/>` : "";

  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    filter +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `<headerFooter><oddFooter>&amp;L${xmlText(sheet.title)}&amp;RPage &amp;P of &amp;N</oddFooter></headerFooter>` +
    `</worksheet>`;
  return { xml, headerRow, lastRow };
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>` +
  `<fonts count="5">` +
  `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><i/><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>` +
  `<font><sz val="11"/><color rgb="FFB91C1C"/><name val="Calibri"/><family val="2"/></font>` +
  `</fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>` +
  `<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
  `<border><left/><right/><top/><bottom style="thin"><color rgb="FF94A3B8"/></bottom><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="11">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>` +
  `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="164" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf>` +
  `<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>` +
  `<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

export function buildXlsx(sheets: readonly Sheet[]): Buffer {
  if (!sheets.length) throw new Error("A workbook needs at least one sheet.");
  const names = sheetNames(sheets.map((s) => s.name));
  const built = sheets.map(sheetXml);
  const quoted = (n: string) => `'${n.replace(/'/g, "''")}'`;
  const defined = built
    .flatMap((b, i) => {
      const lastCol = columnName(Math.max(1, sheets[i].header.length) - 1);
      return [
        `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlText(quoted(names[i]))}!$${b.headerRow}:$${b.headerRow}</definedName>`,
        ...(sheets[i].rows.length
          ? [`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(quoted(names[i]))}!$A$${b.headerRow}:$${lastCol}$${b.lastRow}</definedName>`]
          : []),
      ];
    })
    .join("");

  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        built.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
        `<definedNames>${defined}</definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        built.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", STYLES],
    ...built.map((b, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, b.xml]),
  ];
  return zip(files.map(([name, text]) => ({ name, data: Buffer.from(text, "utf8") })));
}

/** Plain zip (deflate), enough for Office files. */
export function zip(files: readonly { name: string; data: Buffer }[], now = new Date()): Buffer {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const packed = deflateRawSync(f.data);
    const crc = crc32(f.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

/** Download file name: safe characters only, e.g. "CS-Sem-3-attendance-2026-11-01.xlsx". */
export function fileName(...parts: string[]): string {
  return `${parts.join("-").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")}.xlsx`;
}
