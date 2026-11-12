// Reads the first sheet of an .xlsx file as rows of text (report tests).
import { Workbook } from 'exceljs';

const cellText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? value.toString() : '';

export async function sheetRows(bytes: Buffer): Promise<string[][]> {
  const workbook = new Workbook();
  // ExcelJS's types predate Buffer<ArrayBufferLike>; it reads an ArrayBuffer as well.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  await workbook.xlsx.load(copy as ArrayBuffer);
  const rows: string[][] = [];
  workbook.worksheets[0]?.eachRow((row) => {
    rows.push((row.values as unknown[]).slice(1).map(cellText));
  });
  return rows;
}
