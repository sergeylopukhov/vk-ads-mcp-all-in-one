import { createHash } from "node:crypto";
import { basename, relative, resolve } from "node:path";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export interface ValidatedImageUpload {
  filePath: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  bytes: Buffer;
  size: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ValidatedVideoUpload {
  filePath: string;
  filename: string;
  mimeType: "video/mp4";
  bytes: Buffer;
  size: number;
  sha256: string;
  width: number;
  height: number;
}

export interface ValidatedHtml5Upload {
  filePath: string;
  filename: string;
  mimeType: "application/zip";
  bytes: Buffer;
  size: number;
  sha256: string;
  width: number;
  height: number;
  htmlFile: string;
}

/** Метаданные файла аудитории. Его содержимое намеренно не возвращается из MCP. */
export interface ValidatedRemarketingUserListUpload {
  filePath: string;
  filename: string;
  mimeType: "text/plain" | "text/csv";
  bytes: Buffer;
  size: number;
  sha256: string;
  lineCount: number;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_LEAD_FORM_IMAGE_BYTES = 5 * 1024 * 1024;
/** Локальный защитный лимит MCP, не заявление о лимите VK Ads API. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Локальные fail-closed лимиты HTML5-архива, не заявление о лимитах VK Ads. */
const MAX_HTML5_BYTES = 20 * 1024 * 1024;
const MAX_HTML5_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const MAX_HTML5_ENTRIES = 1_000;
const MAX_HTML5_COMPRESSION_RATIO = 100;
/** Лимит из документации VK Ads для полного списка пользователей. */
const MAX_REMARKETING_LIST_BYTES = 128 * 1024 * 1024;
const MIN_REMARKETING_LIST_LINES = 2_000;
const MAX_REMARKETING_LIST_LINES = 5_000_000;

function resolveRegularFileInRoot(filePath: string, uploadRoot: string, rootName: string): { resolvedFile: string; bytes: Buffer } {
  const root = realpathSync(resolve(uploadRoot));
  const resolvedFile = realpathSync(resolve(filePath));
  const pathFromRoot = relative(root, resolvedFile);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || pathFromRoot.includes("../")) {
    throw new Error(`Файл должен находиться внутри ${rootName}.`);
  }
  if (!statSync(resolvedFile).isFile()) throw new Error("Для загрузки разрешён только обычный файл.");
  return { resolvedFile, bytes: readFileSync(resolvedFile) };
}

function detectImageMime(bytes: Buffer): ValidatedImageUpload["mimeType"] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return undefined;
}

function isMp4(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.subarray(4, 8).toString("ascii") !== "ftyp") return false;
  const brand = bytes.subarray(8, 12).toString("ascii");
  return ["isom", "iso2", "avc1", "mp41", "mp42", "M4V "].includes(brand);
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === undefined) return undefined;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof && length >= 7) return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    offset += length;
  }
  return undefined;
}

function readWebpDimensions(bytes: Buffer): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = bytes.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && bytes.length >= 30) {
    return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return undefined;
}

function readImageDimensions(bytes: Buffer, mimeType: ValidatedImageUpload["mimeType"]): { width: number; height: number } | undefined {
  if (mimeType === "image/png") return readPngDimensions(bytes);
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

interface ZipEntry {
  name: string;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function readZipEntries(bytes: Buffer): ZipEntry[] {
  const lowerBound = Math.max(0, bytes.length - 65_557);
  let eocdOffset = -1;
  for (let offset = bytes.length - 22; offset >= lowerBound; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50 && offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("HTML5-креатив должен быть корректным ZIP-архивом без ZIP64.");
  if (bytes.readUInt16LE(eocdOffset + 4) !== 0 || bytes.readUInt16LE(eocdOffset + 6) !== 0) throw new Error("Многодисковые ZIP-архивы HTML5 не поддерживаются.");
  const entriesCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  if (entriesCount < 1 || entriesCount > MAX_HTML5_ENTRIES || centralOffset + centralSize > eocdOffset) throw new Error("Некорректная структура ZIP-архива HTML5.");

  const entries: ZipEntry[] = [];
  const entryNames = new Set<string>();
  let offset = centralOffset;
  let uncompressedTotal = 0;
  for (let index = 0; index < entriesCount; index += 1) {
    if (offset + 46 > centralOffset + centralSize || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Некорректный central directory ZIP-архива HTML5.");
    const flags = bytes.readUInt16LE(offset + 8);
    const compression = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localHeaderOffset = bytes.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > centralOffset + centralSize || (flags & 0x0009) !== 0 || ![0, 8].includes(compression) || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("ZIP-архив HTML5 содержит неподдерживаемое шифрование, ZIP64, data descriptor или сжатие.");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const pathParts = name.split("/");
    const hasInvalidPathPart = pathParts.some((part, partIndex) => part === ".." || (part === "" && partIndex < pathParts.length - 1));
    if (!name || name.includes("\\") || /[\u0000-\u001f]/u.test(name) || name.startsWith("/") || hasInvalidPathPart || entryNames.has(name)) {
      throw new Error("ZIP-архив HTML5 содержит небезопасный путь файла.");
    }
    entryNames.add(name);
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_HTML5_UNCOMPRESSED_BYTES || (compressedSize > 0 && uncompressedSize > compressedSize * MAX_HTML5_COMPRESSION_RATIO)) {
      throw new Error("ZIP-архив HTML5 превышает безопасный лимит распаковки.");
    }
    if (localHeaderOffset + 30 > bytes.length || bytes.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("ZIP-архив HTML5 содержит некорректный local header.");
    const localFlags = bytes.readUInt16LE(localHeaderOffset + 6);
    const localCompression = bytes.readUInt16LE(localHeaderOffset + 8);
    const localCompressedSize = bytes.readUInt32LE(localHeaderOffset + 18);
    const localUncompressedSize = bytes.readUInt32LE(localHeaderOffset + 22);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    let localName: string;
    try {
      localName = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength));
    } catch {
      throw new Error("ZIP-архив HTML5 содержит некорректное имя local file header.");
    }
    if (localName !== name || localFlags !== flags || localCompression !== compression || localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize || dataOffset + compressedSize > bytes.length) {
      throw new Error("ZIP-архив HTML5 содержит противоречивые local и central headers.");
    }
    entries.push({ name, compression, compressedSize, uncompressedSize, localHeaderOffset });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error("ZIP-архив HTML5 содержит некорректный central directory.");
  return entries;
}

function unzipEntry(bytes: Buffer, entry: ZipEntry): Buffer {
  const nameLength = bytes.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLength = bytes.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);
  const decoded = entry.compression === 0 ? compressed : inflateRawSync(compressed);
  if (decoded.length !== entry.uncompressedSize) throw new Error("ZIP-архив HTML5 содержит повреждённый файл.");
  return decoded;
}

function readHtml5Dimensions(html: string): { width: number; height: number } | undefined {
  const tag = (html.match(/<meta\b[^>]*>/giu) ?? []).find((candidate) => /\bname\s*=\s*(["'])ad\.size\1/iu.test(candidate));
  const content = tag?.match(/\bcontent\s*=\s*(["'])(.*?)\1/iu)?.[2];
  const dimensions = content?.match(/\bwidth\s*=\s*(\d+)\s*[,;]?\s*height\s*=\s*(\d+)\b/iu);
  if (!dimensions) return undefined;
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16_384 || height > 16_384) return undefined;
  return { width, height };
}

/** Читает width/height из MP4 tkhd. Не декодирует видео и fail-closed при неизвестной структуре. */
function readMp4Dimensions(bytes: Buffer): { width: number; height: number } | undefined {
  for (let typeOffset = 4; typeOffset + 4 <= bytes.length; typeOffset += 1) {
    if (bytes.subarray(typeOffset, typeOffset + 4).toString("ascii") !== "tkhd") continue;
    const boxOffset = typeOffset - 4;
    if (boxOffset < 0 || boxOffset + 8 > bytes.length) continue;
    const boxSize = bytes.readUInt32BE(boxOffset);
    if (boxSize < 8 || boxOffset + boxSize > bytes.length) continue;
    const payloadOffset = typeOffset + 4;
    const version = bytes[payloadOffset];
    if (version !== 0 && version !== 1) continue;
    const dimensionsOffset = payloadOffset + (version === 1 ? 88 : 76);
    if (dimensionsOffset + 8 > boxOffset + boxSize) continue;
    const width = bytes.readUInt32BE(dimensionsOffset) / 65_536;
    const height = bytes.readUInt32BE(dimensionsOffset + 4) / 65_536;
    if (Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 16_384 && height <= 16_384) {
      return { width, height };
    }
  }
  return undefined;
}

/** Reads only a regular image file below a configured local upload root. */
export function validateImageUpload(filePath: string, uploadRoot: string): ValidatedImageUpload {
  const root = realpathSync(resolve(uploadRoot));
  const resolvedFile = realpathSync(resolve(filePath));
  const pathFromRoot = relative(root, resolvedFile);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || pathFromRoot.includes("../")) {
    throw new Error("Файл должен находиться внутри VK_ADS_UPLOAD_DIR.");
  }
  if (!statSync(resolvedFile).isFile()) throw new Error("Для загрузки разрешён только обычный файл.");

  const bytes = readFileSync(resolvedFile);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error(`Размер изображения должен быть от 1 до ${MAX_IMAGE_BYTES} байт.`);
  }
  const mimeType = detectImageMime(bytes);
  if (!mimeType) throw new Error("Разрешены только PNG, JPEG и WebP с корректной сигнатурой файла.");
  const dimensions = readImageDimensions(bytes, mimeType);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 16_384 || dimensions.height > 16_384) {
    throw new Error("Не удалось безопасно определить корректные размеры изображения.");
  }

  return {
    filePath: resolvedFile,
    filename: basename(resolvedFile),
    mimeType,
    bytes,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...dimensions,
  };
}

/** Лимиты подтверждены документацией ресурса v1 lead_ads/upload_image/logo. */
export function validateLeadFormImageUpload(filePath: string, uploadRoot: string): ValidatedImageUpload {
  const image = validateImageUpload(filePath, uploadRoot);
  if (image.size > MAX_LEAD_FORM_IMAGE_BYTES) throw new Error("Изображение лид-формы не должно превышать 5 MiB.");
  if (image.mimeType !== "image/png" && image.mimeType !== "image/jpeg") throw new Error("Для изображения лид-формы разрешены только PNG или JPEG.");
  return image;
}

/** Reads only a regular MP4 file below a configured local upload root. */
export function validateVideoUpload(filePath: string, uploadRoot: string): ValidatedVideoUpload {
  const root = realpathSync(resolve(uploadRoot));
  const resolvedFile = realpathSync(resolve(filePath));
  const pathFromRoot = relative(root, resolvedFile);
  if (pathFromRoot === "" || pathFromRoot.startsWith("..") || pathFromRoot.includes("../")) {
    throw new Error("Файл должен находиться внутри VK_ADS_UPLOAD_DIR.");
  }
  if (!statSync(resolvedFile).isFile()) throw new Error("Для загрузки разрешён только обычный файл.");

  const bytes = readFileSync(resolvedFile);
  if (bytes.length === 0 || bytes.length > MAX_VIDEO_BYTES) {
    throw new Error(`Размер видео должен быть от 1 до ${MAX_VIDEO_BYTES} байт.`);
  }
  if (!isMp4(bytes)) throw new Error("Разрешён только MP4 с корректной ISO Base Media сигнатурой файла.");
  const dimensions = readMp4Dimensions(bytes);
  if (!dimensions) throw new Error("Не удалось безопасно определить размеры видео из MP4; upload заблокирован до исправления файла.");

  return {
    filePath: resolvedFile,
    filename: basename(resolvedFile),
    mimeType: "video/mp4",
    bytes,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...dimensions,
  };
}

/** Проверяет ZIP-структуру, единственный HTML-файл и обязательный meta ad.size до upload. */
export function validateHtml5Upload(filePath: string, uploadRoot: string): ValidatedHtml5Upload {
  const { resolvedFile, bytes } = resolveRegularFileInRoot(filePath, uploadRoot, "VK_ADS_UPLOAD_DIR");
  if (!/\.zip$/iu.test(resolvedFile)) throw new Error("HTML5-креатив должен быть ZIP-файлом.");
  if (bytes.length < 22 || bytes.length > MAX_HTML5_BYTES) throw new Error(`Размер HTML5 ZIP должен быть от 22 до ${MAX_HTML5_BYTES} байт.`);
  const entries = readZipEntries(bytes).filter((entry) => !entry.name.endsWith("/"));
  const htmlEntries = entries.filter((entry) => /\.html?$/iu.test(entry.name));
  if (htmlEntries.length !== 1) throw new Error("HTML5 ZIP должен содержать ровно один HTML-файл.");
  const htmlEntry = htmlEntries[0];
  if (!htmlEntry) throw new Error("HTML5 ZIP должен содержать ровно один HTML-файл.");
  const htmlBytes = unzipEntry(bytes, htmlEntry);
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes);
  } catch {
    throw new Error("HTML-файл креатива должен быть в UTF-8.");
  }
  if (html.includes("\0")) throw new Error("HTML5-креатив содержит недопустимый NUL-символ.");
  const dimensions = readHtml5Dimensions(html);
  if (!dimensions) throw new Error("HTML5-креатив должен содержать корректный meta name=\"ad.size\" с width и height.");
  return {
    filePath: resolvedFile,
    filename: basename(resolvedFile),
    mimeType: "application/zip",
    bytes,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    htmlFile: htmlEntry.name,
    ...dimensions,
  };
}

/**
 * Проверяет только форму PII-файла: расположение, кодировку, размер и число
 * записей. Содержимое контактов не логируется, не возвращается и не меняется.
 */
export function validateRemarketingUserListUpload(filePath: string, uploadRoot: string): ValidatedRemarketingUserListUpload {
  const { resolvedFile, bytes } = resolveRegularFileInRoot(filePath, uploadRoot, "VK_ADS_PII_UPLOAD_DIR");
  const extension = basename(resolvedFile).toLowerCase().match(/\.(txt|csv)$/)?.[1];
  if (!extension) throw new Error("Для списка ремаркетинга разрешён только UTF-8 TXT или CSV файл.");
  if (bytes.length < 1 || bytes.length > MAX_REMARKETING_LIST_BYTES) {
    throw new Error(`Размер списка ремаркетинга должен быть от 1 до ${MAX_REMARKETING_LIST_BYTES} байт.`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Файл списка ремаркетинга должен быть в UTF-8 без повреждённых символов.");
  }
  if (text.includes("\0")) throw new Error("Файл списка ремаркетинга содержит недопустимый NUL-символ.");
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.some((line) => line.trim().length === 0 || line.length > 16_384)) {
    throw new Error("Каждая запись списка должна быть непустой и не длиннее 16384 символов.");
  }
  if (lines.length < MIN_REMARKETING_LIST_LINES || lines.length > MAX_REMARKETING_LIST_LINES) {
    throw new Error(`Список ремаркетинга должен содержать от ${MIN_REMARKETING_LIST_LINES} до ${MAX_REMARKETING_LIST_LINES} строк.`);
  }
  return {
    filePath: resolvedFile,
    filename: basename(resolvedFile),
    mimeType: extension === "csv" ? "text/csv" : "text/plain",
    bytes,
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    lineCount: lines.length,
  };
}
