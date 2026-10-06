// ==================== EXPORT WHOLE BOOK (TXT / EPUB) ====================
// JSZip 3.10.1 เก็บไว้ใน repo (ตรง SRI ของ cdnjs) ไม่โหลดจาก CDN: ใช้ได้แม้ออฟไลน์ และไม่ต้องเชื่อใจเซิร์ฟเวอร์ภายนอก
// อ้างอิงจากตำแหน่งของไฟล์นี้ เพื่อให้ใช้ได้ทั้งจากหน้าแอพและหน้า tests/
const JSZIP_URL = new URL('../vendor/jszip.min.js', document.currentScript?.src || location.href).href;
let jszipLoading = null;

function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!jszipLoading) {
    jszipLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_URL;
      s.onload = () => window.JSZip ? resolve(window.JSZip) : reject(new Error('โหลด JSZip ไม่สำเร็จ'));
      s.onerror = () => { jszipLoading = null; reject(new Error('โหลดไลบรารีอ่าน/สร้าง EPUB ไม่สำเร็จ ลองรีโหลดหน้าแล้วทำใหม่')); };
      document.head.appendChild(s);
    });
  }
  return jszipLoading;
}

function safeFileName(name) {
  return String(name || 'novel').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'novel';
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * เลือกเนื้อหาที่จะส่งออก: ไม่รวมตอนกันก๊อปและข้อความจากหน้าเว็บเสมอ
 * ประกาศ/ข้อความผู้เขียนรวมเฉพาะเมื่อผู้ใช้เปิดตัวเลือกไว้ ตอนพิเศษรวมเสมอ
 */
function prepareChaptersForExport(chaps, includeNotes = false) {
  return chaps
    .filter(ch => ch.status !== 'pending' && ch.chapterType !== 'placeholder' && (includeNotes || ch.chapterType !== 'author_note'))
    .map(ch => ({
      ...ch,
      paragraphs: (ch.paragraphs || []).filter(p => {
        const kind = p.kind || 'story';
        if (kind === 'site_junk') return false;
        if (kind === 'author_note' && !includeNotes) return false;
        return (p.th || '').trim();
      })
    }))
    .filter(ch => ch.paragraphs.length > 0);
}

async function loadBookForExport(bookId) {
  const book = (await dbGetAllBooks()).find(b => b.bookId === bookId);
  if (!book) throw new Error('ไม่พบนิยายเรื่องนี้');
  const all = (await dbGetChaptersByBook(bookId)).sort((a, b) => a.order - b.order);
  const chaps = prepareChaptersForExport(all, localStorage.getItem('nov_export_notes') === 'true');
  if (chaps.length === 0) throw new Error('นิยายเรื่องนี้ยังไม่มีตอนที่แปลไว้');
  return { book, chaps };
}

async function exportBookTxt(bookId) {
  try {
    const { book, chaps } = await loadBookForExport(bookId);
    const lines = [book.title || 'นิยาย'];
    if (book.author) lines.push(`ผู้แต่ง: ${book.author}`);
    lines.push('');
    chaps.forEach(ch => {
      lines.push('', `==== ${ch.title} ====`, '');
      (ch.paragraphs || []).forEach(p => lines.push(p.th || '', ''));
    });
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `${safeFileName(book.title)}.txt`);
  } catch (err) {
    appAlert(`ส่งออก TXT ไม่สำเร็จ: ${err.message}`);
  }
}

function xmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch])
    // อักขระควบคุมที่ XML ไม่อนุญาต จะทำให้ e-reader เปิดไฟล์ไม่ได้
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function buildChapterXhtml(chap) {
  const paras = (chap.paragraphs || []).map(p => `    <p>${xmlEscape(p.th)}</p>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th" lang="th">
<head>
  <meta charset="UTF-8" />
  <title>${xmlEscape(chap.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <section epub:type="chapter">
    <h2>${xmlEscape(chap.title)}</h2>
${paras}
  </section>
</body>
</html>`;
}

async function exportBookEpub(bookId) {
  // EPUB ตามแพ็กเกจ (TXT และไฟล์สำรองใช้ได้ทุกระดับ)
  if (typeof requireFeature === 'function' && !requireFeature('epub')) return;
  showGlobalToast('กำลังสร้างไฟล์ EPUB...');
  try {
    const [{ book, chaps }, JSZip] = await Promise.all([loadBookForExport(bookId), loadJSZip()]);
    const title = book.title || 'นิยาย';
    const identifier = `urn:noveltranslate:${book.bookId}`;
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const files = chaps.map((ch, i) => ({ id: `chap${String(i + 1).padStart(4, '0')}`, href: `chap${String(i + 1).padStart(4, '0')}.xhtml`, chap: ch }));

    const zip = new JSZip();
    // mimetype ต้องเป็นไฟล์แรกและไม่บีบอัด ตามมาตรฐาน EPUB
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

    zip.file('OEBPS/style.css', `body { font-family: "Sarabun", "Noto Sans Thai", sans-serif; line-height: 1.8; }
h2 { text-align: center; margin: 1.2em 0; }
p { text-indent: 1.5em; margin: 0 0 0.8em 0; }`);

    zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="th">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${xmlEscape(identifier)}</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>th</dc:language>
    ${book.author ? `<dc:creator>${xmlEscape(book.author)}</dc:creator>` : ''}
    <dc:contributor>Dusktale</dc:contributor>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${files.map(f => `    <item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml"/>`).join('\n')}
  </manifest>
  <spine toc="ncx">
${files.map(f => `    <itemref idref="${f.id}"/>`).join('\n')}
  </spine>
</package>`);

    zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th" lang="th">
<head><meta charset="UTF-8" /><title>สารบัญ</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>สารบัญ</h1>
    <ol>
${files.map(f => `      <li><a href="${f.href}">${xmlEscape(f.chap.title)}</a></li>`).join('\n')}
    </ol>
  </nav>
</body>
</html>`);

    zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="th">
  <head><meta name="dtb:uid" content="${xmlEscape(identifier)}"/></head>
  <docTitle><text>${xmlEscape(title)}</text></docTitle>
  <navMap>
${files.map((f, i) => `    <navPoint id="nav${i + 1}" playOrder="${i + 1}"><navLabel><text>${xmlEscape(f.chap.title)}</text></navLabel><content src="${f.href}"/></navPoint>`).join('\n')}
  </navMap>
</ncx>`);

    files.forEach(f => zip.file(`OEBPS/${f.href}`, buildChapterXhtml(f.chap)));

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
    downloadBlob(blob, `${safeFileName(title)}.epub`);
  } catch (err) {
    appAlert(`ส่งออก EPUB ไม่สำเร็จ: ${err.message}`);
  } finally {
    hideGlobalToast();
  }
}
