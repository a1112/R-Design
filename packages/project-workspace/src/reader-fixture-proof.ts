import { DomainError, digest } from '../../document-core/src/index.js';
import { assertNoPrivateSourceContent } from './index.js';

export const READER_MARKDOWN_SOURCE = 'fixtures/r-md-workspace/06-cjk/short-tokens.md';
export const READER_MARKDOWN_PREPARED = 'src/fixtures/r-md-workspace/06-cjk/short-uiTokens.md';
export const READER_PDF_SOURCES = new Set(['bookmarked-report', 'chinese', 'encrypted', 'multipage', 'sample-report', 'scanned']
  .map(name => `fixtures/r-md-workspace/09-pdf/${name}.pdf`));

/** One plain CJK short-word search fixture; this does not admit token files generally. */
export function proveReaderMarkdownFixture(bytes: Buffer) {
  const text = bytes.toString('utf8');
  assertNoPrivateSourceContent(text);
  if (!bytes.length || bytes.length > 16 * 1024 || text.includes('\0') || text.includes('\ufffd') || !Buffer.from(text).equals(bytes) ||
    !/^# Short Tokens\r?\n/.test(text) || !/[\u3400-\u9fff]/.test(text) || !/\bUI\b/.test(text) || !/\bDB\b/.test(text) || !/\bCJK\b/.test(text) ||
    /(?:https?:|data:|base64|www\.|@|[<>{}\[\]\\]|```)/i.test(text))
    throw new DomainError('ENGINEERING_READER_FIXTURE', '限定 Markdown 须为不含链接、HTML、代码块或私密内容的短词搜索样本', 400);
  return { profile: 'cjk-short-word-markdown-v1', sourceSha256: digest(bytes), bytes: bytes.length, plainTextOnly: true };
}

/** Origin/header proof only. Actual parsing/rendering is separate browser evidence. */
export function proveReaderPdfFixture(sourcePath: string, bytes: Buffer) {
  assertNoPrivateSourceContent(bytes.toString('utf8'));
  if (!READER_PDF_SOURCES.has(sourcePath) || !bytes.length || bytes.length > 1024 * 1024 ||
    !/^%PDF-1\.[0-7]/.test(bytes.subarray(0, 12).toString('ascii')) || !/%%EOF\s*$/.test(bytes.subarray(-128).toString('ascii')))
    throw new DomainError('ENGINEERING_READER_FIXTURE', 'PDF 须为限定目录中至多1MiB的已提交阅读器样本', 400);
  return { profile: 'committed-reader-pdf-v1', sourcePath, sourceSha256: digest(bytes), bytes: bytes.length, parsingVerified: false };
}
