/**
 * Service: Generate PDF Voucher (template LAPAN PLUS, 8 kolom x 12 baris = 96 per A4).
 * Memakai pdfkit (library yang sudah ada di project, ringan, server-side).
 * Dipakai oleh tombol "Download PDF" pada halaman Voucher Hotspot.
 */
const PDFDocument = require('pdfkit');

const COLS = 8;
const ROWS = 12;
const PER_PAGE = COLS * ROWS; // 96 per halaman A4

function slugForFile(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'VOUCHER';
}

// Ikon WiFi putih kecil untuk header hitam.
function drawWifi(doc, cx, cy, scale) {
  doc.save().lineWidth(0.7).strokeColor('#ffffff');
  doc.moveTo(cx - 3 * scale, cy + 2 * scale).quadraticCurveTo(cx, cy - 1 * scale, cx + 3 * scale, cy + 2 * scale).stroke();
  doc.moveTo(cx - 4.6 * scale, cy + 0.4 * scale).quadraticCurveTo(cx, cy - 4 * scale, cx + 4.6 * scale, cy + 0.4 * scale).stroke();
  doc.moveTo(cx - 6.2 * scale, cy - 1.2 * scale).quadraticCurveTo(cx, cy - 7.2 * scale, cx + 6.2 * scale, cy - 1.2 * scale).stroke();
  doc.circle(cx, cy + 3.2 * scale, 0.9 * scale).fillColor('#ffffff').fill();
  doc.restore();
}

function buildVoucherPdfBuffer(opts) {
  return new Promise((resolve, reject) => {
    try {
      const vouchers = Array.isArray(opts.vouchers) ? opts.vouchers : [];
      const brand = String(opts.brand || 'LAPAN PLUS').toUpperCase();
      const validityText = String(opts.validityText || '-');
      const dateText = String(opts.dateText || '');

      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true, info: { Title: 'Voucher ' + brand, Author: brand } });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW = doc.page.width;
      const PH = doc.page.height;
      const margin = 14;
      const gap = 3;
      const cellW = (PW - margin * 2 - gap * (COLS - 1)) / COLS;
      const cellH = (PH - margin * 2 - gap * (ROWS - 1)) / ROWS;
      const headerH = 13;

      if (vouchers.length === 0) {
        doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Tidak ada voucher pada batch ini.', 40, 40);
        doc.end();
        return;
      }

      vouchers.forEach((v, i) => {
        const idxOnPage = i % PER_PAGE;
        if (i > 0 && idxOnPage === 0) doc.addPage();

        const col = idxOnPage % COLS;
        const row = Math.floor(idxOnPage / COLS);
        const x = margin + col * (cellW + gap);
        const y = margin + row * (cellH + gap);

        // Bingkai
        doc.rect(x, y, cellW, cellH).lineWidth(0.5).strokeColor('#94a3b8').stroke();

        // Header hitam + ikon wifi + brand + nomor urut
        doc.rect(x, y, cellW, headerH).fillColor('#000000').fill();
        drawWifi(doc, x + 8, y + 8.6, 1);
        doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6.5);
        doc.text(brand, x + 16, y + 4.2, { width: cellW - 34, align: 'left', lineBreak: false });
        doc.text('[' + String(v.idx != null ? v.idx : (i + 1)) + ']', x + cellW - 16, y + 4.2, { width: 13, align: 'right', lineBreak: false });

        // Kode voucher besar di tengah
        const code = String(v.code || '');
        const pass = String(v.password || '');
        const twoLine = v.password && code !== pass;
        doc.fillColor('#0f172a').font('Helvetica-Bold');
        if (twoLine) {
          const fs1 = Math.min(10, 34 / Math.max(1, code.length));
          doc.fontSize(fs1).text(code, x + 2, y + headerH + 6, { width: cellW - 4, align: 'center', lineBreak: false });
          const fs2 = Math.min(8.5, 28 / Math.max(1, pass.length));
          doc.fontSize(fs2).fillColor('#334155').text('P: ' + pass, x + 2, y + headerH + 18, { width: cellW - 4, align: 'center', lineBreak: false });
        } else {
          const fs = code.length > 9 ? 10 : (code.length > 7 ? 12 : 14);
          doc.fontSize(fs).text(code, x + 2, y + headerH + 12, { width: cellW - 4, align: 'center', lineBreak: false });
        }

        // Garis putus-putus
        doc.save().lineWidth(0.5).strokeColor('#0f172a');
        doc.moveTo(x + 5, y + cellH - 11).lineTo(x + cellW - 5, y + cellH - 11).dash(2, { space: 2 }).stroke();
        doc.undash().restore();

        // Aktif: X Hari (kiri) + tanggal (kanan)
        doc.font('Helvetica').fillColor('#0f172a').fontSize(5.6);
        doc.text('Aktif: ' + validityText, x + 4, y + cellH - 9, { width: cellW / 2, align: 'left', lineBreak: false });
        doc.text(dateText, x + cellW / 2, y + cellH - 9, { width: cellW / 2 - 4, align: 'right', lineBreak: false });
      });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { buildVoucherPdfBuffer, slugForFile, COLS, ROWS, PER_PAGE };
