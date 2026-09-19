/**
 * 零依赖文档导出：用 Node 内置的 zlib 手写一个极简 ZIP 容器，
 * 再往里塞 OOXML（Word 的 .docx / Excel 的 .xlsx 本质都是 zip + xml）。
 *
 * 为什么不引库：README 对外承诺"整个项目只有 express 一个依赖"，
 * 加 docx / exceljs 会让 clone 变重、也违背项目定位。自研约 200 行即可覆盖简历导出。
 */
import zlib from "zlib";

/* ---------------- CRC32 ---------------- */
let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  CRC_TABLE = t;
  return t;
}
function crc32(buf) {
  const t = crcTable();
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/* ---------------- 极简 ZIP 打包（DEFLATE） ---------------- */
/**
 * @param {Array<{name:string, data:Buffer|string}>} entries
 * @returns {Buffer}
 */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf-8");
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), "utf-8");
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const crc = crc32(raw);
    // 1980-01-01 之后的固定时间戳，保证同样内容产出稳定
    const dosTime = 0;
    const dosDate = 0x2100 + 1 + (1 << 5); // 年份 1980 + 月 1 + 日 1

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(deflated.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, deflated);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(deflated.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + deflated.length;
  }

  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/* ---------------- XML 工具 ---------------- */
function xmlEsc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
/** Word 对控制字符很敏感，顺手清掉 */
function safeText(s) {
  return xmlEsc(String(s == null ? "" : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""));
}

/* ---------------- DOCX ---------------- */
const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function docxParagraph(text, { bold = false, size = 21, spaceAfter = 120, italic = false, color = null } = {}) {
  const rPr = [
    bold ? "<w:b/>" : "",
    italic ? "<w:i/>" : "",
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "",
    color ? `<w:color w:val="${color}"/>` : "",
  ].join("");
  return (
    `<w:p><w:pPr><w:spacing w:after="${spaceAfter}"/>` +
    `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}` +
    `<w:rFonts w:ascii="PingFang SC" w:eastAsia="PingFang SC" w:hAnsi="PingFang SC"/></w:rPr></w:pPr>` +
    `<w:r>${rPr ? `<w:rPr>${rPr}<w:rFonts w:ascii="PingFang SC" w:eastAsia="PingFang SC" w:hAnsi="PingFang SC"/></w:rPr>` : ""}` +
    `<w:t xml:space="preserve">${safeText(text)}</w:t></w:r></w:p>`
  );
}

/**
 * @param {object} opts
 * @param {string} opts.title 文档大标题
 * @param {Array<{type:'h1'|'h2'|'p'|'li'|'quote'|'blank', text:string}>} opts.blocks
 */
export function buildDocx({ title = "", blocks = [] } = {}) {
  const body = [];
  if (title) body.push(docxParagraph(title, { bold: true, size: 36, spaceAfter: 240 }));
  for (const b of blocks) {
    const text = String(b?.text ?? "");
    switch (b?.type) {
      case "h1":
        body.push(docxParagraph(text, { bold: true, size: 28, spaceAfter: 160 }));
        break;
      case "h2":
        body.push(docxParagraph(text, { bold: true, size: 24, spaceAfter: 120 }));
        break;
      case "li":
        body.push(docxParagraph("· " + text, { size: 21, spaceAfter: 80 }));
        break;
      case "quote":
        body.push(docxParagraph(text, { size: 20, italic: true, color: "666666", spaceAfter: 120 }));
        break;
      case "blank":
        body.push(docxParagraph("", { size: 21, spaceAfter: 100 }));
        break;
      default:
        body.push(docxParagraph(text, { size: 21, spaceAfter: 140 }));
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W_NS}"><w:body>${body.join("")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: document },
  ]);
}

/* ---------------- XLSX ---------------- */
const S_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function colName(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetXml(rows) {
  const body = (rows || []).map((row, ri) => {
    const cells = (row || []).map((val, ci) => {
      const ref = colName(ci + 1) + (ri + 1);
      if (val === null || val === undefined || val === "") return `<c r="${ref}"/>`;
      if (typeof val === "number" && Number.isFinite(val)) return `<c r="${ref}"><v>${val}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${safeText(val)}</t></is></c>`;
    }).join("");
    // 第一行为表头，加粗
    const style = ri === 0 ? ' s="1"' : "";
    return `<row r="${ri + 1}"${style}>${cells}</row>`;
  }).join("");
  const cols = `<cols>${((rows && rows[0]) || []).map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="18" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="${S_NS}" xmlns:r="${R_NS}">${cols}<sheetData>${body}</sheetData></worksheet>`;
}

/**
 * @param {Array<{name:string, rows:Array<Array<string|number>>}>} sheets
 */
export function buildXlsx(sheets = []) {
  const list = sheets.length ? sheets : [{ name: "Sheet1", rows: [[]] }];
  const safeName = (n, i) => String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, "_").slice(0, 31);

  const sheetEntries = list.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: sheetXml(s.rows),
  }));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${S_NS}" xmlns:r="${R_NS}"><sheets>${
    list.map((s, i) => `<sheet name="${safeText(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")
  }</sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
    list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
  }</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${S_NS}"><fonts count="2"><font><sz val="11"/><name val="PingFang SC"/></font><font><b/><sz val="11"/><name val="PingFang SC"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
</styleSheet>`;

  return zip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels },
    { name: "xl/styles.xml", data: styles },
    ...sheetEntries,
  ]);
}

/* ---------------- 结构化辅助：把 AI 文本切成 blocks ---------------- */
/**
 * 把一段 AI 生成的文本（可能含 markdown 风格标记）切成 docx 可用的 blocks。
 * 规则：# 一级、## 二级、- / * / • 列表、其余为正文。
 */
export function textToBlocks(text, { title = "" } = {}) {
  const out = [];
  if (title) out.push({ type: "h1", text: title });
  String(text || "")
    .split(/\r?\n/)
    .forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (/^#{1,2}\s+/.test(line)) {
        out.push({ type: /^#\s+/.test(line) ? "h1" : "h2", text: line.replace(/^#{1,2}\s+/, "") });
        return;
      }
      if (/^[-*•·]\s+/.test(line)) {
        out.push({ type: "li", text: line.replace(/^[-*•·]\s+/, "").replace(/\*\*/g, "") });
        return;
      }
      if (/^\d+[.、)]\s*/.test(line)) {
        out.push({ type: "li", text: line.replace(/^\d+[.、)]\s*/, "").replace(/\*\*/g, "") });
        return;
      }
      out.push({ type: "p", text: line.replace(/\*\*/g, "") });
    });
  return out;
}
