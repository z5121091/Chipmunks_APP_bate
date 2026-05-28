import cors, { type CorsOptions } from 'cors';
import express, { type Request, type Response } from 'express';
import { inflateSync, strFromU8 } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT || 8080);
const uploadDir = path.resolve(process.cwd(), 'sync-data');
const configuredCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedUploadContentTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (configuredCorsOrigins.length === 0) {
      callback(null, process.env.NODE_ENV !== 'production');
      return;
    }

    callback(null, configuredCorsOrigins.includes(origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
};

const rawExcelParser = express.raw({
  type: Array.from(allowedUploadContentTypes),
  limit: '50mb',
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const sanitizeFileName = (value?: string) => {
  if (!value) {
    return '';
  }

  return Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
    .join('')
    .replace(/^_+|_+$/g, '');
};

const sanitizeSegment = (value?: string) => {
  return sanitizeFileName(value).replace(/\s+/g, '');
};

const buildFileName = (prefix: string, nameSuffix?: string, exactFileName?: string) => {
  const sanitizedFileName = sanitizeFileName(exactFileName);
  if (sanitizedFileName) {
    return sanitizedFileName.endsWith('.xlsx') ? sanitizedFileName : `${sanitizedFileName}.xlsx`;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = sanitizeSegment(nameSuffix);
  return suffix ? `${prefix}_${suffix}_${timestamp}.xlsx` : `${prefix}_${timestamp}.xlsx`;
};

const getRawBody = (body: Request['body']): Buffer | null => {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  return null;
};

const hasAllowedContentType = (contentTypeHeader?: string): boolean => {
  if (!contentTypeHeader) {
    return false;
  }

  const contentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase();
  return allowedUploadContentTypes.has(contentType);
};

const hasZipSignature = (rawBody: Buffer): boolean => {
  if (rawBody.length < 4) {
    return false;
  }

  const signatures = [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ];

  return signatures.some((signature) => rawBody.subarray(0, 4).equals(signature));
};

const XLSX_REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
];

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_MAX_COMMENT_LENGTH = 0xffff;
const ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const MAX_XLSX_CENTRAL_DIRECTORY_SIZE = 2 * 1024 * 1024;
const MAX_XLSX_CENTRAL_DIRECTORY_ENTRIES = 1024;
const MAX_XLSX_XML_ENTRY_COMPRESSED_SIZE = 256 * 1024;
const MAX_XLSX_XML_ENTRY_UNCOMPRESSED_SIZE = 512 * 1024;

type ZipEntryMetadata = {
  compressedSize: number;
  compressionMethod: number;
  flags: number;
  localHeaderOffset: number;
  name: string;
  uncompressedSize: number;
};

const findEndOfCentralDirectoryOffset = (rawBody: Buffer): number => {
  const searchStart = Math.max(
    0,
    rawBody.length - ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH - ZIP_MAX_COMMENT_LENGTH
  );

  for (
    let offset = rawBody.length - ZIP_END_OF_CENTRAL_DIRECTORY_LENGTH;
    offset >= searchStart;
    offset -= 1
  ) {
    if (rawBody.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  return -1;
};

const parseZipCentralDirectory = (rawBody: Buffer): Map<string, ZipEntryMetadata> | null => {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectoryOffset(rawBody);
  if (endOfCentralDirectoryOffset < 0) {
    return null;
  }

  const entryCount = rawBody.readUInt16LE(endOfCentralDirectoryOffset + 10);
  const centralDirectorySize = rawBody.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = rawBody.readUInt32LE(endOfCentralDirectoryOffset + 16);

  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    return null;
  }

  if (
    entryCount === 0 ||
    entryCount > MAX_XLSX_CENTRAL_DIRECTORY_ENTRIES ||
    centralDirectorySize === 0 ||
    centralDirectorySize > MAX_XLSX_CENTRAL_DIRECTORY_SIZE
  ) {
    return null;
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset < 0 ||
    centralDirectoryOffset >= rawBody.length ||
    centralDirectoryEnd > rawBody.length
  ) {
    return null;
  }

  const entries = new Map<string, ZipEntryMetadata>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > centralDirectoryEnd) {
      return null;
    }

    if (rawBody.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      return null;
    }

    const flags = rawBody.readUInt16LE(cursor + 8);
    const compressionMethod = rawBody.readUInt16LE(cursor + 10);
    const compressedSize = rawBody.readUInt32LE(cursor + 20);
    const uncompressedSize = rawBody.readUInt32LE(cursor + 24);
    const fileNameLength = rawBody.readUInt16LE(cursor + 28);
    const extraFieldLength = rawBody.readUInt16LE(cursor + 30);
    const commentLength = rawBody.readUInt16LE(cursor + 32);
    const localHeaderOffset = rawBody.readUInt32LE(cursor + 42);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > centralDirectoryEnd) {
      return null;
    }

    const name = rawBody.toString('utf8', fileNameStart, fileNameEnd);
    entries.set(name, {
      compressedSize,
      compressionMethod,
      flags,
      localHeaderOffset,
      name,
      uncompressedSize,
    });

    cursor = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
};

const extractZipEntryText = (
  rawBody: Buffer,
  entry: ZipEntryMetadata
): string | null => {
  if (entry.flags & 0x1) {
    return null;
  }

  if (
    entry.compressedSize > MAX_XLSX_XML_ENTRY_COMPRESSED_SIZE ||
    entry.uncompressedSize > MAX_XLSX_XML_ENTRY_UNCOMPRESSED_SIZE
  ) {
    return null;
  }

  if (entry.localHeaderOffset + 30 > rawBody.length) {
    return null;
  }

  if (rawBody.readUInt32LE(entry.localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    return null;
  }

  const localFileNameLength = rawBody.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraFieldLength = rawBody.readUInt16LE(entry.localHeaderOffset + 28);
  const payloadStart = entry.localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
  const payloadEnd = payloadStart + entry.compressedSize;

  if (payloadEnd > rawBody.length) {
    return null;
  }

  const payload = rawBody.subarray(payloadStart, payloadEnd);

  try {
    if (entry.compressionMethod === 0) {
      if (entry.compressedSize !== entry.uncompressedSize) {
        return null;
      }
      return strFromU8(payload);
    }

    if (entry.compressionMethod === 8) {
      const inflated = inflateSync(new Uint8Array(payload), {
        out: new Uint8Array(entry.uncompressedSize),
      });
      return strFromU8(inflated);
    }

    return null;
  } catch (error) {
    console.error(`[xlsx] 解压条目失败: ${entry.name}`, error);
    return null;
  }
};

const hasValidXlsxSignature = (rawBody: Buffer): boolean => {
  if (!hasZipSignature(rawBody)) {
    return false;
  }

  try {
    const archiveEntries = parseZipCentralDirectory(rawBody);
    if (!archiveEntries) {
      return false;
    }

    const requiredEntries = XLSX_REQUIRED_ENTRIES.map((entryName) => archiveEntries.get(entryName));
    if (requiredEntries.some((entry) => !entry)) {
      return false;
    }

    const contentTypesXml = extractZipEntryText(rawBody, requiredEntries[0]!);
    const rootRelationshipsXml = extractZipEntryText(rawBody, requiredEntries[1]!);
    const workbookXml = extractZipEntryText(rawBody, requiredEntries[2]!);

    if (!contentTypesXml || !rootRelationshipsXml || !workbookXml) {
      return false;
    }

    return (
      contentTypesXml.includes('<Types') &&
      contentTypesXml.includes('/xl/workbook.xml') &&
      rootRelationshipsXml.includes('<Relationships') &&
      rootRelationshipsXml.includes('officeDocument') &&
      rootRelationshipsXml.includes('xl/workbook.xml') &&
      workbookXml.includes('<workbook')
    );
  } catch (error) {
    console.error('[xlsx] 文件结构校验失败:', error);
    return false;
  }
};

const handleExcelUpload =
  (prefix: string, successMessage: string) => async (req: Request, res: Response) => {
    try {
      const contentTypeHeader = req.headers['content-type'];
      const normalizedContentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : contentTypeHeader;

      if (!hasAllowedContentType(normalizedContentType)) {
        res.status(415).json({
          success: false,
          message: '仅支持上传 Excel 文件',
        });
        return;
      }

      const rawBody = getRawBody(req.body);

      if (!rawBody || rawBody.length === 0) {
        res.status(400).json({
          success: false,
          message: '上传内容为空',
        });
        return;
      }

      if (!hasValidXlsxSignature(rawBody)) {
        res.status(400).json({
          success: false,
          message: '文件内容不是有效的 Excel xlsx 文件',
        });
        return;
      }

      await mkdir(uploadDir, { recursive: true });

      const nameSuffix =
        typeof req.query.name_suffix === 'string' ? req.query.name_suffix : undefined;
      const exactFileName =
        typeof req.query.file_name === 'string' ? req.query.file_name : undefined;
      const fileName = buildFileName(prefix, nameSuffix, exactFileName);
      const filePath = path.join(uploadDir, fileName);

      await writeFile(filePath, rawBody);

      res.status(200).json({
        success: true,
        message: successMessage,
        fileName,
        count: 1,
      });
    } catch (error) {
      console.error(`[${prefix}] 上传失败:`, error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : '服务器处理失败',
      });
    }
  };

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    port,
  });
});

app.get('/api/v1/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'ok',
    port,
  });
});

app.post('/inbound', rawExcelParser, handleExcelUpload('inbound', '入库数据同步成功'));
app.post('/outbound', rawExcelParser, handleExcelUpload('outbound', '出库数据同步成功'));
app.post('/inventory', rawExcelParser, handleExcelUpload('inventory', '盘点数据同步成功'));
app.post('/labels', rawExcelParser, handleExcelUpload('labels', '标签数据同步成功'));
app.post('/materials', rawExcelParser, handleExcelUpload('materials', '物料数据同步成功'));

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}/`);
});
