export type ExportCell = string | number | boolean | null;
export type ExportRow = Record<string, ExportCell>;

export interface InMemoryXlsx {
  columns: string[];
  content: string;
  byteLength: number;
}

export interface StatisticsExportInput {
  items: Record<string, unknown>[];
  total?: Record<string, unknown>;
  includeTotal: boolean;
}

function safeCell(value: ExportCell): string {
  const text = value === null ? "" : String(value);
  // Excel/LibreOffice не должны исполнять формулы из рекламных текстов или URL.
  const formulaSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${formulaSafe.replaceAll('"', '""')}"`;
}

/** Создаёт CSV только в памяти; на диск и во внешние URL ничего не записывает. */
export function toCsv(rows: ExportRow[]): { columns: string[]; content: string } {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const lines = [columns.map(safeCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => safeCell(row[column] ?? null)).join(","));
  return { columns, content: `\uFEFF${lines.join("\r\n")}\r\n` };
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Минимальный ZIP без сжатия: XLSX остаётся полностью в памяти и не требует зависимостей. */
function zipStore(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + content.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xlsxCell(reference: string, value: ExportCell): string {
  if (value === null) return "";
  if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  // Строки всегда inlineStr: начало с =, +, - или @ не трактуется Excel как формула.
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

/** Создаёт минимальный валидный XLSX в base64, не создавая временных файлов. */
export function toXlsx(rows: ExportRow[]): InMemoryXlsx {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort();
  const sheetRows = [columns, ...rows.map((row) => columns.map((column) => row[column] ?? null))]
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xlsxCell(`${columnName(columnIndex)}${rowIndex + 1}`, value)).join("")}</row>`)
    .join("");
  const archive = zipStore([
    { name: "[Content_Types].xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: "_rels/.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: "xl/workbook.xml", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="VK Ads export" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/worksheets/sheet1.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>` },
  ]);
  return { columns, content: archive.toString("base64"), byteLength: archive.length };
}

function exportValue(value: unknown): ExportCell {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  return JSON.stringify(value);
}

function flattenObject(value: Record<string, unknown>, prefix = "", output: ExportRow = {}): ExportRow {
  for (const [key, item] of Object.entries(value)) {
    const column = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      flattenObject(item as Record<string, unknown>, column, output);
    } else {
      output[column] = exportValue(item);
    }
  }
  return output;
}

/** Нормализует ответ statistics в плоские строки для CSV/XLSX, не меняя исходные значения. */
export function statisticsToExportRows(input: StatisticsExportInput): ExportRow[] {
  const source = input.includeTotal && input.total
    ? [...input.items.map((item) => ({ row_type: "item", ...item })), { row_type: "total", ...input.total }]
    : input.items.map((item) => ({ row_type: "item", ...item }));
  if (source.length > 1_000) throw new Error("Экспорт ограничен 1000 строками; сузьте период или передайте IDs.");
  return source.map((item) => flattenObject(item));
}
