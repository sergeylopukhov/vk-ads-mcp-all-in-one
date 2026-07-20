import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { validateHtml5Upload, validateImageUpload, validateRemarketingUserListUpload, validateVideoUpload } from "../src/upload-policy.js";

function minimalMp4(width: number, height: number): Buffer {
  const ftyp = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(16)]);
  const tkhd = Buffer.alloc(92);
  tkhd.writeUInt32BE(92, 0);
  tkhd.write("tkhd", 4, "ascii");
  tkhd[8] = 0;
  tkhd.writeUInt32BE(width * 65_536, 84);
  tkhd.writeUInt32BE(height * 65_536, 88);
  return Buffer.concat([ftyp, tkhd]);
}

function storedZip(name: string, data: string, localName = name): Buffer {
  const filename = Buffer.from(name, "utf8");
  const localFilename = Buffer.from(localName, "utf8");
  if (localFilename.length !== filename.length) throw new Error("В тестовом ZIP local name должен иметь ту же длину.");
  const content = Buffer.from(data, "utf8");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(localFilename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const centralOffset = local.length + localFilename.length + content.length;
  const centralSize = central.length + filename.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, localFilename, content, central, filename, end]);
}

describe("политика загрузки изображений", () => {
  const root = resolve("test/fixtures");

  it("принимает только файл с корректной сигнатурой внутри upload-каталога", () => {
    const image = validateImageUpload(resolve(root, "mcp-upload-test.png"), root);
    expect(image.mimeType).toBe("image/png");
    expect(image.size).toBeGreaterThan(0);
    expect(image.sha256).toHaveLength(64);
    expect(image).toMatchObject({ width: 1254, height: 1254 });
  });

  it("не допускает путь за пределами upload-каталога", () => {
    expect(() => validateImageUpload(resolve("package.json"), root)).toThrow("VK_ADS_UPLOAD_DIR");
  });

  it("извлекает размеры JPEG и WebP до upload", () => {
    const mediaRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-image-"));
    const jpegPath = join(mediaRoot, "creative.jpg");
    const webpPath = join(mediaRoot, "creative.webp");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x5f, 0x04, 0x38, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9]);
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBPVP8X", 8, "ascii");
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(1079, 24, 3);
    webp.writeUIntLE(606, 27, 3);
    writeFileSync(jpegPath, jpeg);
    writeFileSync(webpPath, webp);
    try {
      expect(validateImageUpload(jpegPath, mediaRoot)).toMatchObject({ mimeType: "image/jpeg", width: 1080, height: 607 });
      expect(validateImageUpload(webpPath, mediaRoot)).toMatchObject({ mimeType: "image/webp", width: 1080, height: 607 });
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  });

  it("принимает только MP4 с ISO Base Media сигнатурой внутри upload-каталога", () => {
    const videoRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-video-"));
    const videoPath = join(videoRoot, "test.mp4");
    writeFileSync(videoPath, minimalMp4(1920, 1080));
    try {
      const video = validateVideoUpload(videoPath, videoRoot);
      expect(video).toMatchObject({ mimeType: "video/mp4", filename: "test.mp4", width: 1920, height: 1080 });
      expect(video.sha256).toHaveLength(64);
    } finally {
      rmSync(videoRoot, { recursive: true, force: true });
    }
  });

  it("не принимает изображение как видео", () => {
    expect(() => validateVideoUpload(resolve(root, "mcp-upload-test.png"), root)).toThrow("MP4");
  });

  it("не принимает MP4 без доступных размеров", () => {
    const videoRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-video-"));
    const videoPath = join(videoRoot, "metadata-less.mp4");
    writeFileSync(videoPath, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.alloc(16)]));
    try {
      expect(() => validateVideoUpload(videoPath, videoRoot)).toThrow("размеры видео");
    } finally {
      rmSync(videoRoot, { recursive: true, force: true });
    }
  });

  it("принимает HTML5 ZIP только с одним HTML и meta ad.size", () => {
    const htmlRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-html5-"));
    const htmlPath = join(htmlRoot, "creative.zip");
    writeFileSync(htmlPath, storedZip("index.html", '<html><head><meta name="ad.size" content="width=300,height=250"></head><body></body></html>'));
    try {
      expect(validateHtml5Upload(htmlPath, htmlRoot)).toMatchObject({ mimeType: "application/zip", filename: "creative.zip", htmlFile: "index.html", width: 300, height: 250 });
    } finally {
      rmSync(htmlRoot, { recursive: true, force: true });
    }
  });

  it("блокирует HTML5 ZIP без обязательного meta ad.size", () => {
    const htmlRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-html5-"));
    const htmlPath = join(htmlRoot, "creative.zip");
    writeFileSync(htmlPath, storedZip("index.html", "<html><body></body></html>"));
    try {
      expect(() => validateHtml5Upload(htmlPath, htmlRoot)).toThrow("ad.size");
    } finally {
      rmSync(htmlRoot, { recursive: true, force: true });
    }
  });

  it("блокирует HTML5 ZIP, где local header не совпадает с проверенным central directory", () => {
    const htmlRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-html5-"));
    const htmlPath = join(htmlRoot, "creative.zip");
    writeFileSync(htmlPath, storedZip("index.html", '<meta name="ad.size" content="width=300,height=250">', "evil!.html"));
    try {
      expect(() => validateHtml5Upload(htmlPath, htmlRoot)).toThrow("противоречивые local и central headers");
    } finally {
      rmSync(htmlRoot, { recursive: true, force: true });
    }
  });

  it("проверяет PII-список без раскрытия его записей", () => {
    const listRoot = mkdtempSync(join(tmpdir(), "vk-ads-mcp-list-"));
    const listPath = join(listRoot, "audience.txt");
    writeFileSync(listPath, Array.from({ length: 2_000 }, (_, index) => String(index + 1)).join("\n"));
    try {
      const list = validateRemarketingUserListUpload(listPath, listRoot);
      expect(list).toMatchObject({ filename: "audience.txt", mimeType: "text/plain", lineCount: 2_000 });
      expect(list.sha256).toHaveLength(64);
    } finally {
      rmSync(listRoot, { recursive: true, force: true });
    }
  });
});
