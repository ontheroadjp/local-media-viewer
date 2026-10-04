const folderButton = document.querySelector('#folder-button');
const folderInput = document.querySelector('#folder-input');
const folderName = document.querySelector('#folder-name');
const gallery = document.querySelector('#gallery');
const emptyState = document.querySelector('#empty-state');
const imageCount = document.querySelector('#image-count');
const viewer = document.querySelector('#viewer');
const fullImage = document.querySelector('#full-image');
const fullVideo = document.querySelector('#full-video');
const fullPdf = document.querySelector('#full-pdf');
const fullText = document.querySelector('#full-text');
const fullTextContent = fullText.querySelector('pre');
const imageTitle = document.querySelector('#image-title');
const fileDetails = document.querySelector('#file-details');
const exifDetails = document.querySelector('#exif-details');
const position = document.querySelector('#position');
let photos = [], activeIndex = 0;
const visibleTypes = new Set(['image', 'video', 'pdf', 'text']);
const rawObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    rawObserver.unobserve(entry.target);
    const { photo, image } = entry.target._rawPreview;
    makeRawPreview(photo, image, 640).catch(() => image.closest('.photo-card').classList.add('raw-error'));
  });
}, { rootMargin: '240px' }) : null;
const rawExtensions = /\.(3fr|arw|cr2|cr3|crw|dcr|dng|erf|iiq|k25|kdc|mef|mos|mrw|nef|nrw|orf|pef|raf|raw|rw2|rwl|sr2|srf|x3f)$/i;
const videoExtensions = /\.(mp4|m4v|mov|webm|ogv|ogg|avi|mkv)$/i;
const pdfExtensions = /\.pdf$/i;
const textExtensions = /\.(txt|md|markdown)$/i;

folderButton.addEventListener('click', async () => {
  if ('showDirectoryPicker' in window) {
    try {
      const handle = await window.showDirectoryPicker();
      const files = [];
      await walkDirectory(handle, files, `${handle.name}/`);
      setPhotos(files, handle.name);
    } catch (error) { if (error.name !== 'AbortError') console.error(error); }
  } else folderInput.click();
});
folderInput.addEventListener('change', () => {
  const files = [...folderInput.files].filter(isMedia);
  const root = files[0]?.webkitRelativePath?.split('/')[0] || '選択したフォルダ';
  setPhotos(files.map(file => ({ file, relativePath:file.webkitRelativePath })), root);
  folderInput.value = '';
});
async function walkDirectory(handle, result, prefix = '') {
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') { const file = await entry.getFile(); if (isMedia(file)) result.push({ file, relativePath:`${prefix}${file.name}` }); }
    else if (entry.kind === 'directory') await walkDirectory(entry, result, `${prefix}${entry.name}/`);
  }
}
function isMedia(file) { return file.type.startsWith('image/') || file.type.startsWith('video/') || file.type === 'application/pdf' || file.type.startsWith('text/') || /\.(jpe?g|png|gif|webp|avif|heic)$/i.test(file.name) || rawExtensions.test(file.name) || videoExtensions.test(file.name) || pdfExtensions.test(file.name) || textExtensions.test(file.name); }
function setPhotos(entries, name) {
  photos.forEach(p => URL.revokeObjectURL(p.url));
  photos = entries.map(entry => {
    const file = entry.file || entry;
    const relativePath = entry.relativePath || file.name;
    const folders = relativePath.split('/').slice(0, -1);
    // webkitdirectory の先頭には選択フォルダ名が含まれるため除外する。
    const group = folders.length > 1 ? folders.slice(1).join('/') : 'このフォルダ';
    return { file, relativePath, group, url:URL.createObjectURL(file), raw:rawExtensions.test(file.name), video:file.type.startsWith('video/') || videoExtensions.test(file.name), pdf:file.type === 'application/pdf' || pdfExtensions.test(file.name), text:file.type.startsWith('text/') || textExtensions.test(file.name), previews:new Map() };
  }).sort((a,b) => a.group.localeCompare(b.group, 'ja') || a.file.name.localeCompare(b.file.name, 'ja'));
  folderName.textContent = name; imageCount.textContent = `${photos.length} item${photos.length === 1 ? '' : 's'}`;
  gallery.replaceChildren(); emptyState.hidden = photos.length > 0;
  const groups = new Map();
  photos.forEach((photo, index) => {
    if (!groups.has(photo.group)) {
      const section = document.createElement('section'); section.className = 'media-group';
      const heading = document.createElement('h3'); heading.textContent = photo.group;
      const grid = document.createElement('div'); grid.className = 'media-grid';
      section.append(heading, grid); groups.set(photo.group, grid); gallery.append(section);
    }
    const button = document.createElement('button'); button.className = 'photo-card'; button.dataset.name = photo.file.name; button.dataset.type = photo.text ? 'text' : photo.pdf ? 'pdf' : photo.video ? 'video' : 'image'; button.setAttribute('aria-label', `${photo.file.name} を開く`); let preview; if (photo.text) { button.classList.add('text-card'); preview = document.createElement('span'); preview.className = 'text-preview'; const label = document.createElement('span'); label.className = 'text-label'; label.textContent = extension(photo.file.name); const fileName = document.createElement('span'); fileName.className = 'text-name'; fileName.textContent = photo.file.name; preview.append(label, fileName); } else if (photo.pdf) { button.classList.add('pdf-card'); preview = document.createElement('span'); preview.className = 'pdf-preview'; const label = document.createElement('span'); label.className = 'pdf-label'; label.textContent = 'PDF'; const fileName = document.createElement('span'); fileName.className = 'pdf-name'; fileName.textContent = photo.file.name; preview.append(label, fileName); const mark = document.createElement('span'); mark.className = 'pdf-mark'; mark.textContent = 'PDF DOCUMENT'; button.append(mark); } else if (photo.video) { preview = document.createElement('video'); preview.src = photo.url; preview.muted = true; preview.playsInline = true; preview.preload = 'metadata'; preview.addEventListener('loadedmetadata', () => { preview.currentTime = Math.min(.1, preview.duration / 2); }, { once:true }); const mark = document.createElement('span'); mark.className = 'video-mark'; mark.textContent = '▶ VIDEO'; button.append(mark); } else { preview = new Image(); preview.alt = ''; preview.loading = 'lazy'; preview.src = photo.raw ? '' : photo.url; if (photo.raw) { button.classList.add('raw-card'); preview.alt = 'RAW preview'; const status = document.createElement('span'); status.className = 'raw-status'; status.textContent = 'プレビューを作成中'; button.append(status); if (rawObserver) { button._rawPreview = { photo, image:preview }; rawObserver.observe(button); } else { button.classList.add('raw-loading'); makeRawPreview(photo, preview, 640); } } } button.append(preview); button.addEventListener('click', () => openViewer(index)); groups.get(photo.group).append(button);
  });
  applyFilters();
}
function applyFilters() {
  gallery.querySelectorAll('.photo-card').forEach(card => { card.hidden = !visibleTypes.has(card.dataset.type); });
  gallery.querySelectorAll('.media-group').forEach(section => { section.hidden = ![...section.querySelectorAll('.photo-card')].some(card => !card.hidden); });
}
document.querySelectorAll('.filter-button').forEach(button => button.addEventListener('click', () => {
  const type = button.dataset.filter;
  if (visibleTypes.has(type)) visibleTypes.delete(type); else visibleTypes.add(type);
  button.setAttribute('aria-pressed', String(visibleTypes.has(type)));
  applyFilters();
}));
async function openViewer(index) {
  activeIndex = index; const photo = photos[index]; imageTitle.textContent = photo.file.name;
  position.textContent = `${index + 1} / ${photos.length}`;
  fileDetails.replaceChildren(...detailRows([['形式', photo.file.type || extension(photo.file.name)], ['サイズ', `${photo.file.size.toLocaleString()} bytes`], ['更新日', new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium', timeStyle:'short'}).format(photo.file.lastModified)]]));
  exifDetails.replaceChildren(...detailRows([['読み込み中', '…']]));
  if (!viewer.open) viewer.showModal();
  if (photo.text) {
    fullImage.hidden = true; fullVideo.pause(); fullVideo.removeAttribute('src'); fullVideo.hidden = true; fullPdf.removeAttribute('src'); fullPdf.hidden = true;
    fullText.hidden = false; fullTextContent.textContent = '読み込み中…';
    readTextFile(photo.file).then(text => { if (photos[activeIndex] === photo) fullTextContent.textContent = text; });
    exifDetails.replaceChildren(...detailRows([['テキスト文書', '内容をプレーンテキストとして表示しています']]));
    return;
  }
  if (photo.pdf) {
    fullImage.hidden = true; fullVideo.pause(); fullVideo.removeAttribute('src'); fullVideo.hidden = true; fullText.hidden = true;
    fullPdf.hidden = false; fullPdf.src = photo.url;
    exifDetails.replaceChildren(...detailRows([['PDF', 'ブラウザ内ビューアから閲覧・検索・ダウンロードできます']]));
    return;
  }
  if (photo.video) {
    fullImage.hidden = true; fullPdf.removeAttribute('src'); fullPdf.hidden = true; fullText.hidden = true; fullVideo.hidden = false; fullVideo.src = photo.url; fullVideo.load();
    fullVideo.onloadedmetadata = () => { if (photos[activeIndex] === photo) fileDetails.replaceChildren(...detailRows([['形式', photo.file.type || extension(photo.file.name)], ['サイズ', `${photo.file.size.toLocaleString()} bytes`], ['長さ', formatDuration(fullVideo.duration)], ['解像度', `${fullVideo.videoWidth} × ${fullVideo.videoHeight}`], ['更新日', new Intl.DateTimeFormat('ja-JP', {dateStyle:'medium', timeStyle:'short'}).format(photo.file.lastModified)]])); };
    exifDetails.replaceChildren(...detailRows([['動画情報', '再生コントロールから動画を操作できます']]));
    return;
  }
  fullVideo.pause(); fullVideo.removeAttribute('src'); fullVideo.hidden = true; fullPdf.removeAttribute('src'); fullPdf.hidden = true; fullText.hidden = true; fullImage.hidden = false; fullImage.src = photo.previews.get(1800) || photo.previews.get(640) || photo.url;
  if (photo.raw && !photo.previews.get(1800)) { exifDetails.replaceChildren(...detailRows([['RAW プレビュー', '高画質版を変換中…']])); try { await makeRawPreview(photo, null, 1800); fullImage.src = photo.previews.get(1800); } catch (error) { exifDetails.replaceChildren(...detailRows([['RAW プレビュー', '変換に失敗しました。server.py で起動しているか確認してください。']])); } }
  const exifSource = photo.raw && photo.previews.get(1800) ? await (await fetch(photo.previews.get(1800))).blob() : photo.file;
  const exif = await readExif(exifSource);
  if (photos[activeIndex] !== photo) return;
  exifDetails.replaceChildren(...detailRows(exif.length ? exif : [['EXIF', 'この画像には読み取れる EXIF 情報がありません']]));
}
function detailRows(rows) { return rows.map(([key, value]) => { const wrap=document.createElement('div'), dt=document.createElement('dt'), dd=document.createElement('dd'); dt.textContent=key; dd.textContent=value; wrap.append(dt,dd); return wrap; }); }
function extension(name) { return name.split('.').pop().toUpperCase(); }
function formatDuration(seconds) { if (!Number.isFinite(seconds)) return '—'; const minutes = Math.floor(seconds / 60); return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`; }
async function readTextFile(file) { const limit = 5 * 1024 * 1024; const text = await file.slice(0, limit).text(); return file.size > limit ? `${text}\n\n[表示は先頭 5 MiB までです]` : text; }
async function makeRawPreview(photo, image, size) {
  const card = image?.closest('.photo-card');
  if (photo.previews.get(size)) {
    if (image) image.src = photo.previews.get(size);
    card?.classList.remove('raw-loading');
    return photo.previews.get(size);
  }
  card?.classList.add('raw-loading');
  if (!photo.previewPromises) photo.previewPromises = new Map();
  if (!photo.previewPromises.has(size)) photo.previewPromises.set(size, (async () => {
    // キャッシュ照会はブラウザ側で計算したハッシュだけを送る。HIT 時は RAW 本体を送らない。
    try {
      const sourceHash = await localFileHash(photo.file);
      if (sourceHash) {
        const cached = await fetch(`/api/cached-preview?hash=${sourceHash}&size=${size}`);
        if (cached.status === 200) {
          const url = URL.createObjectURL(await cached.blob()); photo.previews.set(size, url);
          return url;
        }
      }
    } catch (error) { console.warn('ローカルハッシュを使えないため、通常変換へ切り替えます。', error); }
    const form = new FormData(); form.append('image', photo.file, photo.file.name); form.append('size', size);
    const response = await fetch('/api/raw-preview', { method:'POST', body:form });
    if (!response.ok) throw new Error(await response.text());
    const url = URL.createObjectURL(await response.blob()); photo.previews.set(size, url);
    return url;
  })());
  try {
    const url = await photo.previewPromises.get(size);
    if (image) image.src = url;
    card?.classList.remove('raw-error');
    return url;
  } catch (error) {
    photo.previewPromises.delete(size);
    card?.classList.add('raw-error');
    throw error;
  } finally { card?.classList.remove('raw-loading'); }
}
async function localFileHash(file) {
  if (file._galleryHash) return file._galleryHash;
  if (!globalThis.crypto?.subtle) return null;
  file._galleryHash = crypto.subtle.digest('SHA-256', await file.arrayBuffer()).then(buffer =>
    [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('')
  );
  return file._galleryHash;
}
document.querySelector('#close-button').addEventListener('click', () => viewer.close());
viewer.addEventListener('close', () => { fullVideo.pause(); fullPdf.removeAttribute('src'); });
document.querySelector('#previous-button').addEventListener('click', () => openViewer((activeIndex - 1 + photos.length) % photos.length));
document.querySelector('#next-button').addEventListener('click', () => openViewer((activeIndex + 1) % photos.length));
window.addEventListener('keydown', e => { if (!viewer.open) return; if (e.key === 'ArrowLeft') openViewer((activeIndex - 1 + photos.length) % photos.length); if (e.key === 'ArrowRight') openViewer((activeIndex + 1) % photos.length); });

async function readExif(file) {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return [];
  try { return parseExif(await file.arrayBuffer()); } catch { return []; }
}
function parseExif(buffer) {
  const view = new DataView(buffer); if (view.getUint16(0) !== 0xffd8) return []; let offset = 2;
  while (offset < view.byteLength) { if (view.getUint8(offset) !== 0xff) break; const marker=view.getUint8(offset+1), length=view.getUint16(offset+2); if (marker === 0xe1 && readAscii(view, offset+4, 4) === 'Exif') return parseTiff(view, offset+10); offset += 2 + length; } return [];
}
function parseTiff(view, start) {
  const little = view.getUint16(start) === 0x4949, u16 = p => view.getUint16(p,little), u32 = p => view.getUint32(p,little); if (u16(start+2) !== 42) return []; const tags={0x010f:'メーカー',0x0110:'機種',0x0132:'撮影日時',0x0112:'向き',0x829a:'露出時間',0x829d:'F値',0x8827:'ISO感度',0x9003:'撮影日時',0x920a:'焦点距離',0xa002:'横幅',0xa003:'縦幅'}; const values=[]; const visit = pointer => { const count=u16(start+pointer); for(let i=0;i<count;i++){ const p=start+pointer+2+i*12, tag=u16(p), type=u16(p+2), n=u32(p+4); if(tag===0x8769) { visit(u32(p+8)); continue; } if(!tags[tag]) continue; const value=readValue(view,start,p,type,n,little); if(value !== undefined) values.push([tags[tag], formatExif(tag,value)]); } }; visit(u32(start+4)); return values;
}
function readValue(v,start,p,type,count,little) { const sizes={1:1,2:1,3:2,4:4,5:8}; const size=(sizes[type]||0)*count, at=size<=4?p+8:start+v.getUint32(p+8,little); if(at+size>v.byteLength) return; if(type===2) return readAscii(v,at,count).replace(/\0/g,''); if(type===3) return v.getUint16(at,little); if(type===4) return v.getUint32(at,little); if(type===5) { const a=v.getUint32(at,little),b=v.getUint32(at+4,little); return b ? a/b : 0; } }
function formatExif(tag, value) { if(tag===0x829a) return `1/${Math.round(1/value)} 秒`; if(tag===0x829d) return `f/${value.toFixed(1)}`; if(tag===0x920a) return `${value.toFixed(0)} mm`; if(tag===0x0112) return ['','標準','左右反転','180°','上下反転','90°右','90°右・反転','90°左','90°左・反転'][value] || value; return value; }
function readAscii(v, at, length) { let text=''; for(let i=0;i<length && at+i<v.byteLength;i++) text += String.fromCharCode(v.getUint8(at+i)); return text; }
