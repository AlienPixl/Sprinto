import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type WorklogExportFormat = "csv" | "excel" | "pdf";

export type WorklogExportColumnKey = "epic" | "issue" | "user";

export type WorklogExportColumn = {
  key: WorklogExportColumnKey;
  label: string;
};

export type WorklogExportFilter = {
  label: string;
  value: string;
};

export type WorklogExportRow = {
  values: Record<WorklogExportColumnKey, string>;
  urls: Partial<Record<WorklogExportColumnKey, string>>;
  source: string;
  sourceUrl: string;
  secondsSpent: number;
};

export type WorklogExportBlock = {
  label: string;
  totalSeconds: number;
  rows: WorklogExportRow[];
};

export type WorklogExportPayload = {
  blocks: WorklogExportBlock[];
  columns: WorklogExportColumn[];
  fileBaseName: string;
  filters: WorklogExportFilter[];
  primaryGroupLabel: string;
  showSourceColumn: boolean;
  summary: {
    blockCount: number;
    issueCount: number;
    totalEntries: number;
    totalSeconds: number;
    userCount: number;
  };
};

const EXPORT_TEXT = "#223228";
const EXPORT_MUTED = "#6a726e";

export function buildWorklogCsv(payload: WorklogExportPayload) {
  const header = [...payload.columns.map((column) => column.label), ...(payload.showSourceColumn ? ["Source"] : []), "Time"];
  const preface = [
    ["Sprinto Jira Worklog report"],
    ...payload.filters.map((filter) => [`${filter.label}: ${filter.value || "-"}`]),
    [""],
  ].map((row) => row.map((value) => csvValue(value)).join(","));

  const lines = payload.blocks.flatMap((block, blockIndex) => {
    const rows = block.rows.map((row, rowIndex) => [
      ...payload.columns.map((column, columnIndex) =>
        csvValue(shouldRenderGroupedValue(block.rows, rowIndex, columnIndex, payload.columns) ? row.values[column.key] : "")
      ),
      ...(payload.showSourceColumn ? [csvValue(row.source)] : []),
      csvValue(formatDuration(row.secondsSpent)),
    ].join(","));

    const subtotal = payload.columns.map((_, columnIndex) => csvValue(columnIndex === Math.max(payload.columns.length - 1, 0) ? "Subtotal" : ""));
    if (payload.showSourceColumn) {
      subtotal.push(csvValue(""));
    }
    rows.push([...subtotal, csvValue(formatDuration(block.totalSeconds))].join(","));

    if (blockIndex < payload.blocks.length - 1) {
      rows.push(header.map(() => csvValue("")).join(","));
    }

    return rows;
  });

  lines.push(
    [
      ...payload.columns.map((_, columnIndex) => csvValue(columnIndex === Math.max(payload.columns.length - 1, 0) ? "Grand total" : "")),
      ...(payload.showSourceColumn ? [csvValue("")] : []),
      csvValue(formatDuration(payload.summary.totalSeconds)),
    ].join(",")
  );

  return [...preface, header.join(","), ...lines].join("\n");
}

export async function exportWorklogFile(format: WorklogExportFormat, payload: WorklogExportPayload) {
  if (format === "csv") {
    const csv = buildWorklogCsv(payload);
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${payload.fileBaseName}.csv`);
    return;
  }

  const logoAsset = await loadLogoAsset();

  if (format === "excel") {
    const buffer = await buildExcelFile(payload, logoAsset);
    downloadBlob(
      new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `${payload.fileBaseName}.xlsx`
    );
    return;
  }

  const bytes = await buildPdfFile(payload, logoAsset);
  downloadBlob(new Blob([bytes], { type: "application/pdf" }), `${payload.fileBaseName}.pdf`);
}

async function buildExcelFile(payload: WorklogExportPayload, logoAsset: ExportImageAsset | null) {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sprinto";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    views: [{ showGridLines: false }],
  });

  sheet.properties.defaultRowHeight = 20;
  sheet.views = [{ state: "frozen", ySplit: 0 }];
  sheet.columns = [
    ...payload.columns.map((column) => ({
      key: column.key,
      width: column.key === "user" ? 22 : 18,
    })),
    ...(payload.showSourceColumn ? [{ key: "source", width: 30 }] : []),
    { key: "time", width: 12 },
  ];

  if (logoAsset) {
    const logoImageId = workbook.addImage({
      buffer: logoAsset.bytes,
      extension: logoAsset.extension,
    });
    sheet.addImage(logoImageId, {
      tl: { col: 0, row: 0 },
      ext: { width: 170, height: 52 },
    });
  }

  const lastColumnLetter = getExcelColumnLetter(payload.columns.length + (payload.showSourceColumn ? 1 : 0) + 1);
  sheet.mergeCells(`C1:${lastColumnLetter}2`);
  const titleCell = sheet.getCell("C1");
  titleCell.value = "Jira Worklog report";
  titleCell.font = { bold: true, size: 18, color: { argb: "FF223228" } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  let filterRow = 5;
  for (const filter of payload.filters) {
    sheet.getCell(`A${filterRow}`).value = filter.label;
    sheet.getCell(`A${filterRow}`).font = { bold: true, color: { argb: "FF223228" } };
    sheet.mergeCells(`B${filterRow}:${lastColumnLetter}${filterRow}`);
    sheet.getCell(`B${filterRow}`).value = filter.value || "-";
    sheet.getCell(`B${filterRow}`).font = { color: { argb: "FF223228" } };
    filterRow += 1;
  }

  const header = [...payload.columns.map((column) => column.label), ...(payload.showSourceColumn ? ["Source"] : []), "Time"];
  const tableHeaderRowIndex = filterRow + 2;
  const headerRow = sheet.getRow(tableHeaderRowIndex);
  header.forEach((value, index) => {
    headerRow.getCell(index + 1).value = value;
  });
  styleHeaderRow(headerRow);
  sheet.views = [{ state: "frozen", ySplit: tableHeaderRowIndex }];

  let rowPointer = tableHeaderRowIndex + 1;
  for (const block of payload.blocks) {
    block.rows.forEach((row, rowIndex) => {
      const values = payload.columns.map((column, columnIndex) =>
        shouldRenderGroupedValue(block.rows, rowIndex, columnIndex, payload.columns) ? row.values[column.key] : ""
      );
      const detailRow = sheet.getRow(rowPointer);
      detailRow.values = [...values, ...(payload.showSourceColumn ? [row.source] : []), formatDuration(row.secondsSpent)];
      styleBodyRow(detailRow);
      rowPointer += 1;
    });

    const subtotalRow = sheet.getRow(rowPointer);
    subtotalRow.values = [
      ...payload.columns.map((_, columnIndex) => (columnIndex === Math.max(payload.columns.length - 1, 0) ? "Subtotal" : "")),
      ...(payload.showSourceColumn ? [""] : []),
      formatDuration(block.totalSeconds),
    ];
    styleSubtotalRow(subtotalRow);
    rowPointer += 2;
  }

  const grandTotalRow = sheet.getRow(rowPointer);
  grandTotalRow.values = [
    ...payload.columns.map((_, columnIndex) => (columnIndex === Math.max(payload.columns.length - 1, 0) ? "Grand total" : "")),
    ...(payload.showSourceColumn ? [""] : []),
    formatDuration(payload.summary.totalSeconds),
  ];
  styleGrandTotalRow(grandTotalRow);

  applySheetChrome(sheet, 1, rowPointer);

  return workbook.xlsx.writeBuffer();
}

async function buildPdfFile(payload: WorklogExportPayload, logoAsset: ExportImageAsset | null) {
  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageSize = { width: 842, height: 595 };
  const margin = 34;
  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);
  let cursorY = pageSize.height - margin;

  if (logoAsset) {
    const logoImage = logoAsset.extension === "png"
      ? await pdfDoc.embedPng(logoAsset.bytes)
      : await pdfDoc.embedJpg(logoAsset.bytes);
    page.drawImage(logoImage, {
      x: margin,
      y: cursorY - 34,
      width: 120,
      height: 34,
    });
  }

  cursorY -= 56;

  for (const filter of payload.filters) {
    page.drawText(pdfSafeText(filter.label), {
      x: margin,
      y: cursorY,
      font: boldFont,
      size: 9,
      color: rgbFromHex(EXPORT_TEXT),
    });
    page.drawText(pdfSafeText(filter.value || "-"), {
      x: margin + 92,
      y: cursorY,
      font: regularFont,
      size: 9,
      color: rgbFromHex(EXPORT_TEXT),
    });
    cursorY -= 16;
  }

  page.drawText(pdfSafeText("Grouped table"), {
    x: margin,
    y: cursorY,
    font: boldFont,
    size: 12,
    color: rgbFromHex(EXPORT_TEXT),
  });
  cursorY -= 18;

  const tableColumns = [...payload.columns.map((column) => column.label), ...(payload.showSourceColumn ? ["Source"] : []), "Time"];
  const weights = [
    ...payload.columns.map(() => 1.15),
    ...(payload.showSourceColumn ? [1.55] : []),
    0.75,
  ];
  const contentWidth = pageSize.width - margin * 2;
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const widths = weights.map((weight) => (contentWidth * weight) / totalWeight);

  ({ page, cursorY } = ensurePdfTableHeader({
    boldFont,
    cursorY,
    headers: tableColumns,
    margin,
    page,
    pdfDoc,
    pageSize,
    widths,
  }));

  for (const block of payload.blocks) {
    if (cursorY < 92) {
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);
      cursorY = pageSize.height - margin;
      ({ page, cursorY } = ensurePdfTableHeader({
        boldFont,
        cursorY,
        headers: tableColumns,
        margin,
        page,
        pdfDoc,
        pageSize,
        widths,
      }));
    }

    drawPdfBlockLabel(page, boldFont, margin, cursorY, contentWidth, `${payload.primaryGroupLabel}: ${block.label}`, formatDuration(block.totalSeconds));
    cursorY -= 18;

    block.rows.forEach((row, rowIndex) => {
      if (cursorY < 70) {
        page = pdfDoc.addPage([pageSize.width, pageSize.height]);
        cursorY = pageSize.height - margin;
        ({ page, cursorY } = ensurePdfTableHeader({
          boldFont,
          cursorY,
          headers: tableColumns,
          margin,
          page,
          pdfDoc,
          pageSize,
          widths,
        }));
      }

      const cells = [
        ...payload.columns.map((column, columnIndex) =>
          shouldRenderGroupedValue(block.rows, rowIndex, columnIndex, payload.columns) ? row.values[column.key] : ""
        ),
        ...(payload.showSourceColumn ? [row.source] : []),
        formatDuration(row.secondsSpent),
      ];
      drawPdfTableRow(page, regularFont, margin, cursorY, widths, cells);
      cursorY -= 16;
    });

    cursorY -= 6;
  }

  return pdfDoc.save();
}

function ensurePdfTableHeader({
  boldFont,
  cursorY,
  headers,
  margin,
  page,
  pdfDoc,
  pageSize,
  widths,
}: {
  boldFont: any;
  cursorY: number;
  headers: string[];
  margin: number;
  page: any;
  pdfDoc: PDFDocument;
  pageSize: { width: number; height: number };
  widths: number[];
}) {
  if (cursorY < 80) {
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);
    cursorY = pageSize.height - margin;
  }
  drawPdfHeaderRow(page, boldFont, margin, cursorY, widths, headers);
  return { page, cursorY: cursorY - 18 };
}

function drawPdfHeaderRow(page: any, font: any, x: number, y: number, widths: number[], values: string[]) {
  page.drawRectangle({
    x,
    y: y - 4,
    width: widths.reduce((sum, value) => sum + value, 0),
    height: 16,
    color: rgb(0.94, 0.91, 0.87),
    borderColor: rgb(0.86, 0.81, 0.75),
    borderWidth: 0.6,
  });
  let cursorX = x + 4;
  values.forEach((value, index) => {
    page.drawText(truncatePdfText(pdfSafeText(value), font, 8, widths[index] - 8), {
      x: cursorX,
      y,
      font,
      size: 8,
      color: rgbFromHex(EXPORT_TEXT),
    });
    cursorX += widths[index];
  });
}

function drawPdfBlockLabel(page: any, font: any, x: number, y: number, width: number, label: string, total: string) {
  page.drawRectangle({
    x,
    y: y - 4,
    width,
    height: 15,
    color: rgb(0.99, 0.95, 0.9),
  });
  page.drawText(truncatePdfText(pdfSafeText(label), font, 8, width - 84), {
    x: x + 4,
    y,
    font,
    size: 8,
    color: rgbFromHex(EXPORT_TEXT),
  });
  page.drawText(pdfSafeText(total), {
    x: x + width - 50,
    y,
    font,
    size: 8,
    color: rgbFromHex(EXPORT_TEXT),
  });
}

function drawPdfTableRow(page: any, font: any, x: number, y: number, widths: number[], values: string[]) {
  let cursorX = x + 4;
  values.forEach((value, index) => {
    page.drawText(truncatePdfText(pdfSafeText(value), font, 8, widths[index] - 8), {
      x: cursorX,
      y,
      font,
      size: 8,
      color: rgbFromHex(EXPORT_TEXT),
    });
    cursorX += widths[index];
  });
}

function truncatePdfText(value: string, font: any, size: number, maxWidth: number) {
  if (!value) {
    return "";
  }
  if (font.widthOfTextAtSize(value, size) <= maxWidth) {
    return value;
  }
  let next = value;
  while (next.length > 1 && font.widthOfTextAtSize(`${next}…`, size) > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next}…`;
}

type ExportImageAsset = {
  bytes: Uint8Array;
  extension: "png" | "jpeg";
};

async function loadLogoAsset(): Promise<ExportImageAsset | null> {
  return loadImageAsset("/branding/logo");
}

async function loadImageAsset(url: string): Promise<ExportImageAsset | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const extension = blob.type.includes("jpeg") || blob.type.includes("jpg") ? "jpeg" : "png";
    return { bytes, extension };
  } catch {
    return null;
  }
}

function applySheetChrome(sheet: any, fromRow: number, toRow: number) {
  for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.eachCell((cell: any) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE5D9CA" } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  }
}

function styleHeaderRow(row: any) {
  row.font = { bold: true, color: { argb: "FF223228" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2ECE5" } };
}

function styleBodyRow(row: any) {
  row.eachCell((cell: any) => {
    cell.alignment = { vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFF1E8DE" } },
    };
  });
}

function styleSubtotalRow(row: any) {
  row.font = { bold: true, color: { argb: "FF223228" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4EA" } };
}

function styleGrandTotalRow(row: any) {
  row.font = { bold: true, color: { argb: "FF223228" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBE5D6" } };
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function shouldRenderGroupedValue(rows: WorklogExportRow[], rowIndex: number, columnIndex: number, columns: WorklogExportColumn[]) {
  if (rowIndex === 0) {
    return true;
  }

  const current = rows[rowIndex];
  const previous = rows[rowIndex - 1];

  for (let index = 0; index <= columnIndex; index += 1) {
    const key = columns[index].key;
    if (current.values[key] !== previous.values[key]) {
      return true;
    }
  }

  return false;
}

function csvValue(value: string) {
  return `"${String(value || "").replaceAll("\"", "\"\"")}"`;
}

function rgbFromHex(color: string) {
  const normalized = String(color || "#000000").replace("#", "").padStart(6, "0");
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  return rgb(red, green, blue);
}

function pdfSafeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\x20-\x7E]/g, " ");
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) {
    return `${remainingMinutes}m`;
  }
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

function getExcelColumnLetter(columnNumber: number) {
  let result = "";
  let current = columnNumber;
  while (current > 0) {
    const modulo = (current - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    current = Math.floor((current - modulo) / 26);
  }
  return result;
}
