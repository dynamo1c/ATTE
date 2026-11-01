import { crc32, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, fileName, sheetNames, xmlText } from "./xlsx";

/** Read a zip back (central directory → inflate), checking every CRC. */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = buf.readUInt16LE(local + 26);
    const data = inflateRawSync(buf.subarray(local + 30 + localNameLen, local + 30 + localNameLen + size));
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString("utf8"));
    p += 46 + nameLen;
  }
  return out;
}

describe("xlsx", () => {
  it("column names", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });

  it("escapes text and drops characters XML can't hold", () => {
    expect(xmlText(`a<b>&"c"\u0001`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;");
  });

  it("tab names are legal and unique", () => {
    expect(sheetNames(["CS Sem 3: DSP/Lab", "cs sem 3: dsp/lab", "", "x".repeat(40)])).toEqual(["CS Sem 3  DSP Lab", "cs sem 3  dsp lab 2", "Sheet3", "x".repeat(31)]);
  });

  it("writes a valid package with text, numbers, styles and Kannada", () => {
    const file = buildXlsx([
      {
        name: "Attendance",
        title: "CS Sem 3 · Attendance",
        notes: ["Up to 1 Nov 2026"],
        header: ["Reg no", "Name", "Overall %"],
        rows: [
          ["204CS25001", "ದಿವ್ಯ <Swamy>", { value: 61.1, style: "pctRed" }],
          ["204CS25002", "=HYPERLINK(\"x\")", 88],
          ["204CS25003", null, Number.NaN],
        ],
        freezeCols: 2,
        footer: ["P = present"],
      },
      { name: "Empty", title: "Nothing", header: ["A"], rows: [] },
    ]);
    const parts = unzip(file);
    expect([...parts.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]);
    const s1 = parts.get("xl/worksheets/sheet1.xml")!;
    expect(s1).toContain("ದಿವ್ಯ &lt;Swamy&gt;");
    // Formulas are never written: text stays text.
    expect(s1).not.toContain("<f>");
    expect(s1).toContain(`t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(&quot;x&quot;)</t>`);
    expect(s1).toContain(`<c r="C5" s="6"><v>61.1</v></c>`);
    expect(s1).not.toContain("NaN");
    expect(s1).toContain(`<pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/>`);
    expect(s1).toContain(`<autoFilter ref="A4:C7"/>`);
    expect(parts.get("xl/workbook.xml")).toContain(`'Attendance'!$4:$4`);
    expect(parts.get("xl/worksheets/sheet2.xml")).not.toContain("autoFilter");
  });

  it("safe download names", () => {
    expect(fileName("CS Sem 3", "attendance", "2026-11-01")).toBe("CS-Sem-3-attendance-2026-11-01.xlsx");
    expect(fileName("../../etc", "x")).toBe("etc-x.xlsx");
  });
});
