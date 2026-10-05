from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import copy
from datetime import datetime, timezone
import json
import mimetypes
import os
import re
import traceback
import uuid

try:
    from supabase import create_client
except (ImportError, AttributeError):
    create_client = None


BUCKET_NAME = "mockup-studio-assets"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
MAX_CHUNK_BYTES = 2 * 1024 * 1024
MAX_CHUNKS = 12
ALLOWED_ASSET_TYPES = {
    "scene_background": {"image/png", "image/jpeg", "image/webp"},
    "product_box_clean": {"image/png"},
    "product_only_clean": {"image/png"},
    "original_photo": {"image/png", "image/jpeg"},
    "foreground_mask": {"image/png"},
    "optional_graphic": {"image/png", "image/jpeg", "image/webp"},
    "template_thumbnail": {"image/png", "image/jpeg", "image/webp"},
    "output": {"image/png"},
}
ASSET_SCOPE = {
    "scene_background": "template",
    "foreground_mask": "template",
    "optional_graphic": "template",
    "template_thumbnail": "template",
    "product_box_clean": "product",
    "product_only_clean": "product",
    "original_photo": "product",
    "output": "output",
}

_client = None


def get_supabase():
    global _client
    if _client is not None:
        return _client
    if create_client is None:
        raise RuntimeError(
            "Supabase Python paketi yüklü değil. requirements.txt bağımlılıklarını kurun."
        )
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY") or "").strip()
    if not url or not key:
        raise RuntimeError(
            "Mockup Studio için SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ayarlanmalıdır."
        )
    _client = create_client(url, key)
    return _client


def require_uuid(value, field_name):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError(f"Geçersiz {field_name}.")


def require_name(value, field_name="isim", limit=160):
    name = str(value or "").strip()
    if not name:
        raise ValueError(f"{field_name.capitalize()} zorunludur.")
    return name[:limit]


def clean_filename(value):
    value = os.path.basename(value or "image.png")
    stem, extension = os.path.splitext(value)
    safe_stem = re.sub(r"[^a-zA-Z0-9_-]+", "-", stem).strip("-") or "image"
    safe_extension = re.sub(r"[^a-zA-Z0-9.]", "", extension.lower())
    return safe_stem[:70] + safe_extension[:10]


def reidentify_document(document):
    cloned = copy.deepcopy(document if isinstance(document, dict) else {})
    for layer in cloned.get("layers", []):
        layer["id"] = str(uuid.uuid4())
    return cloned


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            if query.get("asset"):
                self.send_asset(query["asset"][0])
                return
            resource = query.get("resource", ["templates"])[0]
            if resource == "templates":
                self.send_template_list()
            elif resource == "template":
                self.send_template(query.get("id", [None])[0])
            elif resource == "versions":
                self.send_versions(query.get("template_id", [None])[0])
            elif resource == "version":
                self.send_version(query.get("id", [None])[0])
            elif resource == "products":
                self.send_product_assets()
            elif resource == "outputs":
                self.send_output_list()
            else:
                raise ValueError("Geçersiz Mockup Studio kaynağı.")
        except ValueError as error:
            self.send_json(400, {"success": False, "error": str(error)})
        except Exception as error:
            self.log_error("Mockup Studio GET failed: %s", error)
            self.send_json(500, {"success": False, "error": str(error)})

    def do_POST(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            query_action = query.get("action", [""])[0]
            if query_action == "upload":
                self.upload_asset(query)
                return
            if query_action == "upload_chunk":
                self.upload_chunk(query)
                return
            payload = self.read_json()
            action = payload.get("action", "save_template")
            actions = {
                "save_template": self.save_template,
                "duplicate_template": self.duplicate_template,
                "rename_template": self.rename_template,
                "set_thumbnail": self.set_thumbnail,
                "finalize_upload": self.finalize_upload,
                "create_output": self.create_output,
                "rename_output": self.rename_output,
            }
            if action not in actions:
                raise ValueError("Geçersiz Mockup Studio işlemi.")
            actions[action](payload)
        except ValueError as error:
            self.send_json(400, {"success": False, "error": str(error)})
        except Exception as error:
            self.log_error("Mockup Studio POST failed: %s", error)
            traceback.print_exc()
            self.send_json(500, {"success": False, "error": str(error)})

    def do_DELETE(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            resource = query.get("resource", ["template"])[0]
            item_id = require_uuid(query.get("id", [None])[0], "kayıt kimliği")
            table = "mockup_templates" if resource == "template" else "mockup_outputs"
            if resource not in ("template", "output"):
                raise ValueError("Yalnızca şablon veya çıktı silinebilir.")
            response = (
                get_supabase().table(table)
                .update({"deleted_at": datetime.now(timezone.utc).isoformat()})
                .eq("id", item_id)
                .is_("deleted_at", "null")
                .execute()
            )
            self.send_json(200, {
                "success": True,
                "deleted_id": item_id,
                "soft_deleted": True,
                "record": (response.data or [None])[0],
            })
        except ValueError as error:
            self.send_json(400, {"success": False, "error": str(error)})
        except Exception as error:
            self.log_error("Mockup Studio DELETE failed: %s", error)
            self.send_json(500, {"success": False, "error": str(error)})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def send_template_list(self):
        response = (
            get_supabase().table("mockup_templates")
            .select("id,name,status,schema_version,current_version,layer_count,slot_count,thumbnail_asset_id,updated_at,created_at")
            .is_("deleted_at", "null")
            .order("updated_at", desc=True)
            .execute()
        )
        rows = response.data or []
        self.attach_asset_paths(rows, "thumbnail_asset_id", "thumbnail_path")
        self.send_json(200, {"success": True, "templates": rows})

    def send_template(self, raw_id):
        template_id = require_uuid(raw_id, "şablon kimliği")
        response = (
            get_supabase().table("mockup_templates")
            .select("*")
            .eq("id", template_id)
            .is_("deleted_at", "null")
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            self.send_json(404, {"success": False, "error": "Şablon bulunamadı."})
            return
        self.send_json(200, {"success": True, "template": rows[0]})

    def send_versions(self, raw_template_id):
        template_id = require_uuid(raw_template_id, "şablon kimliği")
        response = (
            get_supabase().table("mockup_template_versions")
            .select("id,template_id,template_name,version_number,snapshot,created_at")
            .eq("template_id", template_id)
            .order("version_number", desc=True)
            .execute()
        )
        self.send_json(200, {"success": True, "versions": response.data or []})

    def send_version(self, raw_id):
        version_id = require_uuid(raw_id, "sürüm kimliği")
        response = (
            get_supabase().table("mockup_template_versions")
            .select("*")
            .eq("id", version_id)
            .limit(1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            self.send_json(404, {"success": False, "error": "Şablon sürümü bulunamadı."})
            return
        self.send_json(200, {"success": True, "version": rows[0]})

    def send_product_assets(self):
        response = (
            get_supabase().table("mockup_assets")
            .select("*")
            .eq("asset_scope", "product")
            .in_("asset_type", ["product_box_clean", "product_only_clean", "original_photo"])
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        self.send_json(200, {"success": True, "products": response.data or []})

    def send_output_list(self):
        response = (
            get_supabase().table("mockup_outputs")
            .select("*")
            .is_("deleted_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        rows = response.data or []
        self.attach_asset_paths(rows, "export_asset_id", "export_path")
        self.attach_asset_paths(rows, "product_asset_id", "product_path")
        self.send_json(200, {"success": True, "outputs": rows})

    def save_template(self, payload):
        template_id = require_uuid(payload.get("id"), "şablon kimliği")
        name = require_name(payload.get("name"), "şablon adı", 120)
        document = payload.get("document")
        if not isinstance(document, dict):
            raise ValueError("Şablon belgesi geçersiz.")
        layers = document.get("layers", [])
        if not isinstance(layers, list):
            raise ValueError("Şablon katmanları liste olmalıdır.")
        slot_count = sum(1 for layer in layers if layer.get("type") == "product_slot")
        response = get_supabase().rpc("save_mockup_template", {
            "p_id": template_id,
            "p_name": name,
            "p_schema_version": int(document.get("schemaVersion", 2)),
            "p_document": document,
            "p_layer_count": len(layers),
            "p_slot_count": slot_count,
        }).execute()
        saved = response.data
        if isinstance(saved, list):
            saved = saved[0] if saved else None
        asset_ids = [
            asset.get("id") for asset in document.get("assets", [])
            if asset.get("id")
        ]
        if asset_ids:
            get_supabase().table("mockup_assets").update({"template_id": template_id}).in_("id", asset_ids).execute()
        self.send_json(200, {"success": True, "template": saved})

    def duplicate_template(self, payload):
        source_id = require_uuid(payload.get("id"), "şablon kimliği")
        source_response = (
            get_supabase().table("mockup_templates")
            .select("*").eq("id", source_id).is_("deleted_at", "null").limit(1).execute()
        )
        sources = source_response.data or []
        if not sources:
            raise ValueError("Kopyalanacak şablon bulunamadı.")
        source = sources[0]
        new_id = str(uuid.uuid4())
        name = require_name(payload.get("name") or f"{source['name']} Kopya", "şablon adı", 120)
        document = reidentify_document(source.get("document") or {})
        layers = document.get("layers", [])
        response = get_supabase().rpc("save_mockup_template", {
            "p_id": new_id,
            "p_name": name,
            "p_schema_version": int(document.get("schemaVersion", 2)),
            "p_document": document,
            "p_layer_count": len(layers),
            "p_slot_count": sum(1 for layer in layers if layer.get("type") == "product_slot"),
        }).execute()
        saved = response.data
        if isinstance(saved, list):
            saved = saved[0] if saved else None
        if source.get("thumbnail_asset_id"):
            thumbnail_response = (
                get_supabase().table("mockup_templates")
                .update({"thumbnail_asset_id": source["thumbnail_asset_id"]})
                .eq("id", new_id).execute()
            )
            if thumbnail_response.data:
                saved = thumbnail_response.data[0]
        self.send_json(201, {"success": True, "template": saved})

    def rename_template(self, payload):
        template_id = require_uuid(payload.get("id"), "şablon kimliği")
        name = require_name(payload.get("name"), "şablon adı", 120)
        response = (
            get_supabase().table("mockup_templates")
            .update({"name": name})
            .eq("id", template_id).is_("deleted_at", "null").execute()
        )
        self.send_json(200, {"success": True, "template": (response.data or [None])[0]})

    def set_thumbnail(self, payload):
        template_id = require_uuid(payload.get("id"), "şablon kimliği")
        asset_id = require_uuid(payload.get("asset_id"), "önizleme varlık kimliği")
        response = (
            get_supabase().table("mockup_templates")
            .update({"thumbnail_asset_id": asset_id})
            .eq("id", template_id).is_("deleted_at", "null").execute()
        )
        self.send_json(200, {"success": True, "template": (response.data or [None])[0]})

    def create_output(self, payload):
        output_id = require_uuid(payload.get("id"), "çıktı kimliği")
        name = require_name(payload.get("name"), "çıktı adı", 160)
        snapshot = payload.get("template_snapshot")
        if not isinstance(snapshot, dict):
            raise ValueError("Çıktı için şablon snapshot'ı zorunludur.")
        row = {
            "id": output_id,
            "name": name,
            "export_asset_id": require_uuid(payload.get("export_asset_id"), "çıktı varlık kimliği"),
            "product_asset_id": require_uuid(payload.get("product_asset_id"), "ürün varlık kimliği"),
            "template_id": require_uuid(payload.get("template_id"), "şablon kimliği") if payload.get("template_id") else None,
            "template_name": require_name(payload.get("template_name"), "şablon adı", 120),
            "template_version": int(payload.get("template_version", 0)),
            "template_snapshot": snapshot,
        }
        if row["template_version"] <= 0:
            raise ValueError("Geçerli şablon sürümü zorunludur.")
        response = get_supabase().table("mockup_outputs").insert(row).execute()
        self.send_json(201, {"success": True, "output": (response.data or [row])[0]})

    def rename_output(self, payload):
        output_id = require_uuid(payload.get("id"), "çıktı kimliği")
        name = require_name(payload.get("name"), "çıktı adı", 160)
        response = (
            get_supabase().table("mockup_outputs")
            .update({"name": name})
            .eq("id", output_id).is_("deleted_at", "null").execute()
        )
        self.send_json(200, {"success": True, "output": (response.data or [None])[0]})

    def upload_asset(self, query):
        asset_type = query.get("asset_type", [""])[0]
        if asset_type not in ALLOWED_ASSET_TYPES:
            raise ValueError("Geçersiz Mockup Studio varlık türü.")
        mime_type = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if mime_type not in ALLOWED_ASSET_TYPES[asset_type]:
            allowed = ", ".join(sorted(ALLOWED_ASSET_TYPES[asset_type]))
            raise ValueError(f"Bu varlık türü için izin verilen formatlar: {allowed}")
        length = self.content_length()
        if length <= 0:
            raise ValueError("Yüklenecek dosya boş olamaz.")
        if length > MAX_UPLOAD_BYTES:
            raise ValueError("Dosya boyutu en fazla 20 MB olabilir.")

        template_id = None
        if query.get("template_id", [None])[0]:
            template_id = require_uuid(query["template_id"][0], "şablon kimliği")
        original_filename = clean_filename(query.get("filename", ["image.png"])[0])
        file_bytes = self.rfile.read(length)
        asset = self.persist_asset(asset_type, mime_type, original_filename, file_bytes, template_id)
        self.send_json(201, {"success": True, "asset": asset})

    def upload_chunk(self, query):
        upload_id = require_uuid(query.get("upload_id", [None])[0], "yükleme kimliği")
        try:
            chunk_index = int(query.get("chunk_index", ["-1"])[0])
        except (TypeError, ValueError):
            raise ValueError("Geçersiz parça sırası.")
        if chunk_index < 0 or chunk_index >= MAX_CHUNKS:
            raise ValueError("Geçersiz parça sırası.")
        length = self.content_length()
        if length <= 0:
            raise ValueError("Yükleme parçası boş olamaz.")
        if length > MAX_CHUNK_BYTES:
            raise ValueError("Yükleme parçası en fazla 2 MB olabilir.")
        body = self.rfile.read(length)
        chunk_path = self.chunk_path(upload_id, chunk_index)
        get_supabase().storage.from_(BUCKET_NAME).upload(
            path=chunk_path,
            file=body,
            file_options={"content-type": "application/octet-stream", "upsert": "false"},
        )
        self.send_json(201, {"success": True, "chunk_index": chunk_index})

    def finalize_upload(self, payload):
        upload_id = require_uuid(payload.get("upload_id"), "yükleme kimliği")
        asset_type = str(payload.get("asset_type") or "")
        if asset_type != "output":
            raise ValueError("Parçalı yükleme yalnızca çıktı PNG için kullanılabilir.")
        mime_type = str(payload.get("mime_type") or "").lower()
        if mime_type != "image/png":
            raise ValueError("Çıktı dosyası PNG olmalıdır.")
        try:
            chunk_count = int(payload.get("chunk_count", 0))
        except (TypeError, ValueError):
            raise ValueError("Geçersiz parça sayısı.")
        if chunk_count <= 0 or chunk_count > MAX_CHUNKS:
            raise ValueError("Geçersiz parça sayısı.")
        client = get_supabase()
        chunk_paths = [self.chunk_path(upload_id, index) for index in range(chunk_count)]
        try:
            parts = []
            total_size = 0
            for chunk_path in chunk_paths:
                downloaded = client.storage.from_(BUCKET_NAME).download(chunk_path)
                part = downloaded if isinstance(downloaded, bytes) else downloaded.content
                total_size += len(part)
                if total_size > MAX_UPLOAD_BYTES:
                    raise ValueError("Birleştirilmiş çıktı dosyası en fazla 20 MB olabilir.")
                parts.append(part)
            file_bytes = b"".join(parts)
            if not file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("Birleştirilen çıktı geçerli bir PNG değil.")
            filename = clean_filename(payload.get("filename") or "output.png")
            asset = self.persist_asset("output", "image/png", filename, file_bytes, None)
            self.send_json(201, {"success": True, "asset": asset})
        finally:
            try:
                client.storage.from_(BUCKET_NAME).remove(chunk_paths)
            except Exception as cleanup_error:
                self.log_error("Mockup Studio chunk cleanup failed: %s", cleanup_error)

    @staticmethod
    def chunk_path(upload_id, chunk_index):
        return f"_chunks/{upload_id}/{chunk_index:04d}.part"

    def persist_asset(self, asset_type, mime_type, original_filename, file_bytes, template_id):
        asset_id = str(uuid.uuid4())
        extension = os.path.splitext(original_filename)[1] or mimetypes.guess_extension(mime_type) or ".bin"
        scope = ASSET_SCOPE[asset_type]
        owner_folder = template_id or "library"
        storage_path = f"{scope}/{owner_folder}/{asset_id}{extension}"
        client = get_supabase()
        client.storage.from_(BUCKET_NAME).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime_type, "upsert": "false"},
        )
        row = {
            "id": asset_id,
            "template_id": template_id,
            "asset_scope": scope,
            "asset_type": asset_type,
            "storage_path": storage_path,
            "original_filename": original_filename,
            "mime_type": mime_type,
            "size_bytes": len(file_bytes),
        }
        try:
            response = client.table("mockup_assets").insert(row).execute()
        except Exception:
            client.storage.from_(BUCKET_NAME).remove([storage_path])
            raise
        return (response.data or [row])[0]

    def send_asset(self, raw_path):
        storage_path = str(raw_path or "")
        if not storage_path or ".." in storage_path or storage_path.startswith("/"):
            raise ValueError("Geçersiz dosya yolu.")
        metadata_response = (
            get_supabase().table("mockup_assets")
            .select("mime_type").eq("storage_path", storage_path).limit(1).execute()
        )
        rows = metadata_response.data or []
        if not rows:
            self.send_json(404, {"success": False, "error": "Dosya bulunamadı."})
            return
        downloaded = get_supabase().storage.from_(BUCKET_NAME).download(storage_path)
        body = downloaded if isinstance(downloaded, bytes) else downloaded.content
        self.send_response(200)
        self.send_header("Content-Type", rows[0].get("mime_type") or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, max-age=3600")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def attach_asset_paths(self, rows, id_field, path_field):
        ids = [row.get(id_field) for row in rows if row.get(id_field)]
        if not ids:
            return
        response = get_supabase().table("mockup_assets").select("id,storage_path,original_filename").in_("id", ids).execute()
        mapping = {item["id"]: item for item in (response.data or [])}
        for row in rows:
            asset = mapping.get(row.get(id_field)) or {}
            row[path_field] = asset.get("storage_path")
            row[path_field.replace("_path", "_name")] = asset.get("original_filename")

    def read_json(self):
        length = self.content_length()
        if length <= 0:
            raise ValueError("İstek verisi boş olamaz.")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Geçersiz JSON verisi.")

    def content_length(self):
        try:
            return int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return 0

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
