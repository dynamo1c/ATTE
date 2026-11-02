import { describe, expect, it } from "vitest";
import { readCsv, readTable, numberText, xmlDecode } from "./sheet-read";
import { buildXlsx, zip } from "./xlsx";

const csv = (s: string) => readCsv(Buffer.from(s, "utf8"));
const cells = (rows: { cells: string[] }[]) => rows.map((r) => r.cells);

describe("readCsv", () => {
  it("reads quoted cells, doubled quotes and line breaks inside quotes", () => {
    const rows = csv('Name,Note\n"Rao, K","said ""hi"""\n"two\nlines",x\nlast,row');
    expect(cells(rows)).toEqual([["Name", "Note"], ["Rao, K", 'said "hi"'], ["two lines", "x"], ["last", "row"]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 5]);
  });

  it("handles BOM, CRLF, semicolons, blank lines and trailing empty cells", () => {
    const rows = csv("﻿a;b;c\r\n1;2;\r\n\r\n;;\r\n3; 4 ;5");
    expect(cells(rows)).toEqual([["a", "b", "c"], ["1", "2"], ["3", "4", "5"]]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 5]);
  });

  it("reads tab-separated text pasted from Excel", () => {
    expect(cells(csv("a\tb\n1\t2"))).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("falls back to Windows-1252 when the file is not UTF-8", () => {
    const rows = readCsv(Buffer.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0x6f, 0x73, 0xe9])); // "José" in Windows-1252
    expect(cells(rows)).toEqual([["Name"], ["José"]]);
  });

  it("collapses odd spacing and non-breaking spaces", () => {
    expect(cells(csv("  Ravi   Kumar  ,x"))).toEqual([["Ravi Kumar", "x"]]);
  });
});

describe("readTable", () => {
  it("reads back an .xlsx made by our writer, with row numbers as Excel shows them", () => {
    const file = buildXlsx([{ name: "Data", title: "Students", header: ["Reg no", "Mobile", "Marks"], rows: [["204CS25012", 9845012345, 42.5], ["204CS25013", "", 7]] }]);
    const r = readTable(file, "x.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r.format).toBe("xlsx");
    const header = r.rows.findIndex((x) => x.cells[0] === "Reg no");
    expect(r.rows.slice(header).map((x) => x.cells)).toEqual([
      ["Reg no", "Mobile", "Marks"],
      ["204CS25012", "9845012345", "42.5"],
      ["204CS25013", "", "7"],
    ]);
    expect(r.rows[header + 1].line).toBe(r.rows[header].line + 1);
  });

  it("reads shared strings, rich text, sparse cells, booleans and namespaced tags", () => {
    const sheet = `<?xml version="1.0"?><x:worksheet xmlns:x="ns"><x:sheetData>
      <x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="s"><x:v>1</x:v></x:c></x:row>
      <x:row r="4"><x:c r="A4" t="b"><x:v>1</x:v></x:c><x:c r="B4"><x:v>9.845012345E9</x:v></x:c><x:c r="C4" t="inlineStr"><x:is><x:t>a &amp; b</x:t></x:is></x:c></x:row>
    </x:sheetData></x:worksheet>`;
    const files = [
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "xl/workbook.xml", data: Buffer.from('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId7"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", data: Buffer.from('<Relationships><Relationship Id="rId7" Target="worksheets/data.xml"/></Relationships>') },
      { name: "xl/worksheets/data.xml", data: Buffer.from(sheet) },
      { name: "xl/sharedStrings.xml", data: Buffer.from('<sst><si><t>Name</t></si><si><r><t>Mo</t></r><r><t xml:space="preserve">bile</t></r><rPh><t>x</t></rPh></si></sst>') },
    ];
    const r = readTable(zip(files), "x.xlsx");
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toEqual([
      { line: 1, cells: ["Name", "", "Mobile"] },
      { line: 4, cells: ["TRUE", "9845012345", "a & b"] },
    ]);
  });

  it("explains old .xls / password-protected files, empty and broken files", () => {
    expect(readTable(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2]), "a.xls")).toMatchObject({ ok: false, error: expect.stringContaining(".xls") });
    expect(readTable(Buffer.alloc(0), "a.csv")).toMatchObject({ ok: false, error: "The file is empty." });
    expect(readTable(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]), "a.xlsx")).toMatchObject({ ok: false });
    expect(readTable(Buffer.from("just text"), "a.xlsx")).toMatchObject({ ok: false, error: expect.stringContaining("not a valid Excel") });
    expect(readTable(Buffer.from('a,"b\n1,2'), "a.csv")).toMatchObject({ ok: false, error: expect.stringContaining("never closed") });
  });
});

describe("helpers", () => {
  it("writes numbers in full", () => {
    expect(numberText("9.845012345E9")).toBe("9845012345");
    expect(numberText("0.30000000000000004")).toBe("0.3");
    expect(numberText("45000")).toBe("45000");
  });

  it("decodes XML entities and Excel escapes", () => {
    expect(xmlDecode("a&lt;b&#x41;&#66;_x000D_")).toBe("a<bAB\r");
  });
});
