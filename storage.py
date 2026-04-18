"""
File storage abstraction — Cloudflare R2 or local filesystem.

When R2 env vars are set, all files go to R2.
Otherwise falls back to local filesystem (for development).
"""
import os

_R2_ACCOUNT_ID = os.environ.get('R2_ACCOUNT_ID')
_R2_ACCESS_KEY = os.environ.get('R2_ACCESS_KEY_ID')
_R2_SECRET     = os.environ.get('R2_SECRET_ACCESS_KEY')
_R2_BUCKET     = os.environ.get('R2_BUCKET')

USE_R2 = all([_R2_ACCOUNT_ID, _R2_ACCESS_KEY, _R2_SECRET, _R2_BUCKET])


def _client():
    import boto3
    return boto3.client(
        's3',
        endpoint_url=f'https://{_R2_ACCOUNT_ID}.r2.cloudflarestorage.com',
        aws_access_key_id=_R2_ACCESS_KEY,
        aws_secret_access_key=_R2_SECRET,
        region_name='auto',
    )


def upload_file(file_storage, key, local_dest_path):
    """
    Upload a Flask FileStorage object.
    R2: uploads to R2 under `key`.
    Local: saves to `local_dest_path`.
    """
    if USE_R2:
        file_storage.stream.seek(0)
        _client().upload_fileobj(file_storage.stream, _R2_BUCKET, key)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(local_dest_path)), exist_ok=True)
        file_storage.save(local_dest_path)


def upload_text(content, key, local_dest_path):
    """
    Upload string/bytes content.
    R2: puts object with given key.
    Local: writes to local_dest_path.
    """
    if isinstance(content, str):
        content_bytes = content.encode('utf-8')
    else:
        content_bytes = content

    if USE_R2:
        _client().put_object(Bucket=_R2_BUCKET, Key=key, Body=content_bytes)
    else:
        os.makedirs(os.path.dirname(os.path.abspath(local_dest_path)), exist_ok=True)
        with open(local_dest_path, 'wb') as f:
            f.write(content_bytes)


def upload_local_file(local_path, key):
    """
    Upload an already-saved local file to R2 (e.g. after DXF→SVG conversion).
    No-op in local mode (file is already where it needs to be).
    """
    if USE_R2:
        with open(local_path, 'rb') as f:
            _client().upload_fileobj(f, _R2_BUCKET, key)


def serve_file(key, local_path, download_name=None, as_attachment=False):
    """
    Serve a file.
    R2: redirects to a 1-hour presigned URL.
    Local: send_from_directory.
    """
    if USE_R2:
        from flask import redirect
        disp = 'attachment' if as_attachment else 'inline'
        params = {'Bucket': _R2_BUCKET, 'Key': key}
        if download_name:
            params['ResponseContentDisposition'] = f'{disp}; filename="{download_name}"'
        url = _client().generate_presigned_url('get_object', Params=params, ExpiresIn=3600)
        return redirect(url)
    else:
        from flask import send_from_directory
        folder = os.path.dirname(os.path.abspath(local_path))
        filename = os.path.basename(local_path)
        return send_from_directory(folder, filename,
                                   as_attachment=as_attachment,
                                   download_name=download_name)


def read_text(key, local_path):
    """
    Read text content of a file (e.g. SVG).
    Returns None if not found.
    """
    if USE_R2:
        try:
            obj = _client().get_object(Bucket=_R2_BUCKET, Key=key)
            return obj['Body'].read().decode('utf-8', errors='replace')
        except Exception:
            return None
    else:
        if os.path.exists(local_path):
            with open(local_path, 'r', encoding='utf-8', errors='replace') as f:
                return f.read()
        return None


def read_bytes(key, local_path):
    """
    Read binary content of a file (e.g. image).
    Returns None if not found.
    """
    if USE_R2:
        try:
            obj = _client().get_object(Bucket=_R2_BUCKET, Key=key)
            return obj['Body'].read()
        except Exception:
            return None
    else:
        if os.path.exists(local_path):
            with open(local_path, 'rb') as f:
                return f.read()
        return None


def delete_file(key, local_path=None):
    """
    Delete a file.
    R2: deletes from bucket.
    Local: removes file if it exists.
    """
    if USE_R2:
        try:
            _client().delete_object(Bucket=_R2_BUCKET, Key=key)
        except Exception:
            pass
    elif local_path and os.path.exists(local_path):
        os.remove(local_path)
