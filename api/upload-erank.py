from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.db_handler import upsert_erank_keywords_for_concept
from etsy_hybrid_module.erank_scoring import parse_erank_csv

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            concept = data.get('concept')
            csv_content = data.get('csv_content')
            is_preview = bool(data.get('preview'))
            
            if not concept or not csv_content:
                self.send_error_json(400, "Concept and csv_content are required.")
                return

            try:
                records, stats, headers = parse_erank_csv(csv_content, concept)
                stats["valid_count"] = len(records)

                if not records:
                    error_msg = f"Okunan sütunlar: {headers}"
                    self.send_error_json(
                        400,
                        "CSV tarandı ancak hacmi 20'nin üzerinde olan geçerli, çok kelimeli veri bulunamadı.",
                        error_msg,
                    )
                    return

            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"ERROR while parsing CSV: {e}")
                self.send_error_json(400, "CSV okuma hatası: " + str(e))
                return

            if is_preview:
                self.send_success_json({
                    "message": f"{len(records)} geçerli keyword bulundu.",
                    "stats": stats,
                    "headers": headers,
                    "preview": records[:10],
                })
                return

            result = upsert_erank_keywords_for_concept(concept, records)
            stats["updated"] = result.get("updated", 0)
            stats["added"] = result.get("added", 0)
            self.send_success_json({
                "message": f"{concept} için {result.get('added', 0)} yeni kayıt eklendi, {result.get('updated', 0)} aynı keyword güncellendi.",
                "data": result.get("data"),
                "stats": stats
            })

        except Exception as e:
            import traceback
            traceback.print_exc()
            err_str = str(e)
            if "Supabase" in err_str:
                self.send_error_json(400, "Supabase bağlantı hatası: " + err_str)
            else:
                self.send_error_json(400, "Sunucu hatası: " + err_str)

    def send_error_json(self, status, message, details=None):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        response_dict = {"success": False, "error": message}
        if details:
            response_dict["details"] = details
        self.wfile.write(json.dumps(response_dict).encode('utf-8'))

    def send_success_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
