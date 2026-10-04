# Local Media Viewer

A private, local-first media browser for images, RAW photos, videos, and PDFs.

Choose a folder from your computer and browse its contents in the browser. Media files never leave your machine: the application binds only to `127.0.0.1`, and RAW preview generation happens locally.

## Features

- Browse a selected folder and all of its subdirectories
- Group media into sections by subdirectory
- View image thumbnails and open a full-size viewer
- Read common JPEG EXIF fields, including camera, date, ISO, aperture, and focal length
- Display RAW files such as CR2, CR3, NEF, ARW, DNG, RAF, ORF, and RW2
- Extract embedded RAW previews when available; generate a local preview when needed
- Play browser-supported videos, including MP4, WebM, and MOV
- Open PDFs in the browser's built-in PDF viewer
- Read TXT and Markdown files as plain text
- Filter images, videos, PDFs, and text documents independently
- Cache generated RAW previews in SQLite, keyed by SHA-256 content hash and output size

## Requirements

- Python 3.10 or newer
- [Pillow](https://python-pillow.org/)
- ImageMagick with RAW support for RAW files that do not contain a usable embedded JPEG preview

On Debian/Ubuntu-based systems, ImageMagick can typically be installed with:

```bash
sudo apt install imagemagick
```

Install Pillow if it is not already available:

```bash
python3 -m pip install Pillow
```

## Run locally

```bash
git clone https://github.com/YOUR-USERNAME/local-media-viewer.git
cd local-media-viewer
python3 server.py
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000) in a modern browser.

Chrome and Edge provide the best folder-selection experience through the File System Access API. Other compatible browsers can use the folder file input fallback.

## RAW preview cache

Generated RAW previews are stored locally in:

```text
.gallery-cache/previews.sqlite3
```

The cache stores JPEG previews as SQLite blobs, indexed by the source file's SHA-256 hash and requested preview size. Its live entries are capped at 2 GiB; least-recently-used previews are removed when that limit is reached.

For a cache hit, the browser calculates the source hash locally and asks the server for the cached preview. The RAW file itself is not uploaded to the server in that case.

## RAW conversion workers

RAW conversion runs in parallel. By default, the number of workers is half of the available CPU cores, capped at 8. Override it when starting the server:

```bash
GALLERY_RAW_WORKERS=6 python3 server.py
```

Lower the number if conversion makes the computer less responsive.

## Supported media

| Type | Examples |
| --- | --- |
| Images | JPEG, PNG, GIF, WebP, AVIF, HEIC |
| RAW photos | CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, and more |
| Video | MP4, M4V, MOV, WebM, OGV, AVI, MKV* |
| Documents | PDF |
| Text documents | TXT, MD, Markdown |

\* Whether a video plays depends on the codecs supported by the browser. MP4 with H.264/AAC and WebM are the most reliable choices.

## Privacy

This project is intended for local use only. It listens on `127.0.0.1`, does not use cloud services, and does not upload media outside of your computer.

## License

Add a license appropriate for your use before publishing the project.
