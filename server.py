#!/usr/bin/env python3
"""Local-only gallery server. RAW uploads are converted in a temporary file only."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import cgi
from io import BytesIO
import hashlib
import os
import sqlite3
import subprocess
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlparse
from PIL import Image, ImageOps

ROOT = Path(__file__).parent
RAW_EXTENSIONS = {'.3fr','.arw','.cr2','.cr3','.crw','.dcr','.dng','.erf','.iiq','.k25','.kdc','.mef','.mos','.mrw','.nef','.nrw','.orf','.pef','.raf','.raw','.rw2','.rwl','.sr2','.srf','.x3f'}
CPU_COUNT = os.cpu_count() or 2
# ImageMagick の各変換を 1 スレッドにし、複数 RAW を並列に処理する。
# 8 コア環境では既定で 4 枚同時。環境変数で 1〜8 に調整できる。
RAW_WORKERS = min(8, max(1, int(os.environ.get('GALLERY_RAW_WORKERS', max(2, CPU_COUNT // 2)))))
CONVERSION_SLOTS = threading.BoundedSemaphore(RAW_WORKERS)
CACHE_DIR = ROOT / '.gallery-cache'
CACHE_DB = CACHE_DIR / 'previews.sqlite3'
CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GiB

def cache_connection():
    CACHE_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(CACHE_DB, timeout=30)
    connection.execute('PRAGMA journal_mode=WAL')
    connection.execute('''CREATE TABLE IF NOT EXISTS previews (
        source_hash TEXT NOT NULL, size INTEGER NOT NULL, image BLOB NOT NULL,
        created_at INTEGER NOT NULL, accessed_at INTEGER NOT NULL,
        PRIMARY KEY (source_hash, size)
    )''')
    return connection

def cached_preview(source_hash, size):
    try:
        with cache_connection() as db:
            row = db.execute('SELECT image FROM previews WHERE source_hash = ? AND size = ?',
                             (source_hash, size)).fetchone()
            if row:
                db.execute('UPDATE previews SET accessed_at = ? WHERE source_hash = ? AND size = ?',
                           (int(time.time()), source_hash, size))
                return row[0]
    except sqlite3.Error:
        pass  # キャッシュ障害では表示を止めず、通常の変換へフォールバックする。
    return None

def cache_preview(source_hash, size, image):
    try:
        now = int(time.time())
        with cache_connection() as db:
            db.execute('INSERT OR REPLACE INTO previews VALUES (?, ?, ?, ?, ?)',
                       (source_hash, size, image, now, now))
            total = db.execute('SELECT COALESCE(SUM(length(image)), 0) FROM previews').fetchone()[0]
            while total > CACHE_LIMIT_BYTES:
                removed = db.execute('''DELETE FROM previews WHERE rowid IN (
                    SELECT rowid FROM previews ORDER BY accessed_at ASC LIMIT 1
                )''')
                if not removed.rowcount:
                    break
                total = db.execute('SELECT COALESCE(SUM(length(image)), 0) FROM previews').fetchone()[0]
    except sqlite3.Error:
        pass

def embedded_jpeg(path):
    """Return the largest JPEG stored in TIFF-based RAW metadata, if present.

    CR2, NEF, ARW and DNG commonly store a camera-rendered JPEG in IFD1.  Reading
    it avoids the expensive RAW demosaic operation entirely.
    """
    data = Path(path).read_bytes()
    if len(data) < 16 or data[:2] not in (b'II', b'MM'):
        return None
    order = 'little' if data[:2] == b'II' else 'big'
    get16 = lambda at: int.from_bytes(data[at:at + 2], order)
    get32 = lambda at: int.from_bytes(data[at:at + 4], order)
    if get16(2) != 42:
        return None
    candidates, seen = [], set()
    def visit(offset):
        if offset in seen or offset + 2 > len(data):
            return
        seen.add(offset)
        count = get16(offset)
        if offset + 2 + count * 12 + 4 > len(data):
            return
        entries, jpeg_offset, jpeg_length = {}, None, None
        for number in range(count):
            at = offset + 2 + number * 12
            tag, value = get16(at), get32(at + 8)
            entries[tag] = value
            if tag == 0x0201: jpeg_offset = value  # JPEGInterchangeFormat
            if tag == 0x0202: jpeg_length = value  # JPEGInterchangeFormatLength
            if tag == 0x014a:  # SubIFDs
                sub_count = get32(at + 4)
                sub_at = value if sub_count * 4 > 4 else at + 8
                for index in range(min(sub_count, 16)):
                    visit(get32(sub_at + index * 4))
        if jpeg_offset is not None and jpeg_length and jpeg_offset + jpeg_length <= len(data):
            candidate = data[jpeg_offset:jpeg_offset + jpeg_length]
            if candidate.startswith(b'\xff\xd8'):
                candidates.append(candidate)
        visit(get32(offset + 2 + count * 12))  # next IFD, normally IFD1
    visit(get32(4))
    return max(candidates, key=len, default=None)

def preview_from_embedded(jpeg, size):
    """Resize only the already-rendered JPEG, which is cheap compared with RAW decoding."""
    image = ImageOps.exif_transpose(Image.open(BytesIO(jpeg)))
    # 小さなカメラ内サムネイルを引き伸ばす代わりに RAW 現像へ回す。
    if min(image.size) < size:
        return None
    image.thumbnail((size, size))
    output = BytesIO()
    image.convert('RGB').save(output, 'JPEG', quality=88, optimize=True)
    return output.getvalue()

class GalleryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path != '/api/raw-preview':
            self.send_error(404)
            return
        content_type = self.headers.get('Content-Type', '')
        if not content_type.startswith('multipart/form-data'):
            self.send_error(400, 'multipart/form-data が必要です')
            return
        form = cgi.FieldStorage(fp=self.rfile, headers=self.headers,
                                environ={'REQUEST_METHOD': 'POST', 'CONTENT_TYPE': content_type})
        uploaded = form['image'] if 'image' in form else None
        # cgi.FieldStorage は Python 3.12 で bool() に変換できない。
        if uploaded is None or not getattr(uploaded, 'filename', None):
            self.send_error(400, '画像がありません')
            return
        suffix = Path(uploaded.filename).suffix.lower()
        if suffix not in RAW_EXTENSIONS:
            self.send_error(400, '対応していない RAW 形式です')
            return
        try:
            target_size = min(max(int(form.getfirst('size', '420')), 160), 1800)
        except ValueError:
            target_size = 420
        try:
            source_bytes = uploaded.file.read()
            source_hash = hashlib.sha256(source_bytes).hexdigest()
            cached = cached_preview(source_hash, target_size)
            if cached:
                self.send_response(200)
                self.send_header('Content-Type', 'image/jpeg')
                self.send_header('Content-Length', str(len(cached)))
                self.send_header('X-Gallery-Cache', 'HIT')
                self.end_headers()
                self.wfile.write(cached)
                return
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as source:
                source.write(source_bytes)
                source_path = source.name
            try:
                # 埋め込みプレビューは一覧用だけに使う。拡大表示では RAW を現像して
                # カメラ内の低解像度 JPEG を引き伸ばさない。
                embedded = embedded_jpeg(source_path) if target_size <= 700 else None
                result_bytes = preview_from_embedded(embedded, target_size) if embedded else None
            except (OSError, ValueError):
                result_bytes = None
            if result_bytes is None:
                # 埋め込み JPEG がない形式のみ、重い RAW デコードを行う。
                with CONVERSION_SLOTS:
                    result = subprocess.run(['convert', '-limit', 'thread', '1', source_path + '[0]', '-auto-orient', '-thumbnail', f'{target_size}x{target_size}>', 'jpeg:-'],
                                            capture_output=True, check=True, timeout=90)
                result_bytes = result.stdout
            cache_preview(source_hash, target_size, result_bytes)
            self.send_response(200)
            self.send_header('Content-Type', 'image/jpeg')
            self.send_header('Content-Length', str(len(result_bytes)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Gallery-Cache', 'MISS')
            self.end_headers()
            self.wfile.write(result_bytes)
        except subprocess.TimeoutExpired:
            self.send_error(504, 'RAW の変換がタイムアウトしました')
        except subprocess.CalledProcessError as error:
            self.send_error(422, 'RAW を変換できませんでした: ' + error.stderr.decode(errors='replace')[-300:])
        finally:
            if 'source_path' in locals() and os.path.exists(source_path):
                os.unlink(source_path)

    def do_GET(self):
        """Return a cached preview using only a client-calculated content hash."""
        request = urlparse(self.path)
        if request.path != '/api/cached-preview':
            return super().do_GET()
        query = parse_qs(request.query)
        source_hash = query.get('hash', [''])[0]
        try:
            size = min(max(int(query.get('size', ['420'])[0]), 160), 1800)
        except ValueError:
            self.send_error(400, 'size が不正です')
            return
        if len(source_hash) != 64 or any(char not in '0123456789abcdef' for char in source_hash):
            self.send_error(400, 'hash が不正です')
            return
        image = cached_preview(source_hash, size)
        if image is None:
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(image)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Gallery-Cache', 'HIT')
        self.end_headers()
        self.wfile.write(image)

if __name__ == '__main__':
    print(f'Local Media Viewer: http://127.0.0.1:8000  (RAW workers: {RAW_WORKERS})')
    ThreadingHTTPServer(('127.0.0.1', 8000), GalleryHandler).serve_forever()
