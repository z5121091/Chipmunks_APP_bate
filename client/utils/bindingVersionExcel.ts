import * as XLSX from 'xlsx';

const VERSION_COLUMN = 3;
const STYLES_PART = '/xl/styles.xml';
const TEXT_FORMAT = '@';
const TEXT_FORMAT_XF = /<xf\b(?=[^>]* numFmtId="49")[^>]*\/>/;

export const writeBindingWorkbook = (workbook: XLSX.WorkBook, sheet: XLSX.WorkSheet): string => {
  const rows: XLSX.RowInfo[] = [];
  const lastRow = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').e.r;
  for (let row = 1; row <= lastRow; row++) {
    const versionCell = sheet[XLSX.utils.encode_cell({ r: row, c: VERSION_COLUMN })] as XLSX.CellObject | undefined;
    if (typeof versionCell?.v !== 'string' || !versionCell.v.includes('\n')) continue;
    versionCell.z = TEXT_FORMAT;
    rows[row] = { hpt: Math.min(409, versionCell.v.split('\n').length * 18) };
  }
  if (rows.length) sheet['!rows'] = rows;

  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }) as string;
  if (!rows.length) return base64;

  // SheetJS writes the built-in text format (49) but does not serialize alignment.
  // Only the multiline version cells above use this format. The styles part is ASCII.
  const archive = XLSX.CFB.read(base64, { type: 'base64' });
  const stylePart = XLSX.CFB.find(archive, STYLES_PART);
  const xml = stylePart?.content ? String.fromCharCode(...stylePart.content) : '';
  const wrapped = xml.replace(TEXT_FORMAT_XF, (xf) =>
    `${xf.slice(0, -2)} applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>`
  );
  if (wrapped === xml) throw new Error('未能设置版本号单元格的自动换行');
  XLSX.CFB.utils.cfb_add(archive, STYLES_PART, Uint8Array.from(wrapped, (character) => character.charCodeAt(0)));
  return XLSX.CFB.write(archive, { type: 'base64', fileType: 'zip' }) as string;
};
