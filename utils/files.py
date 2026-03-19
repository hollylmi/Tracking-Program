ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'gif', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf'}
DOC_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'dwg', 'dxf', 'doc', 'docx', 'xls', 'xlsx'}
PHOTO_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


def safe(s):
    """Sanitize text for fpdf2 core fonts (Latin-1 only)."""
    if s is None:
        return ''
    s = str(s)
    for old, new in {
        '\u2018': "'", '\u2019': "'",
        '\u201c': '"', '\u201d': '"',
        '\u2013': '-', '\u2014': '--',
        '\u2026': '...',
        '\u00a0': ' ',
        '\u2022': '*',
    }.items():
        s = s.replace(old, new)
    return s.encode('latin-1', errors='replace').decode('latin-1')


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_photo(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in PHOTO_EXTENSIONS


def allowed_doc(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in DOC_EXTENSIONS
