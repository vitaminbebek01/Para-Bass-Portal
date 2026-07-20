from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.db_handler import get_all_erank_keywords, delete_erank_keyword

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            data = get_all_erank_keywords(500)
            self.send_success_json(data)
        except Exception as e:
            self.send_error_json(500, "Sunucu hatası", str(e))

    def do_DELETE(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_json(400, "ID belirtilmedi.")
                return

            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            keyword_id = data.get('id')
            keyword_ids = data.get('ids')
            
            if keyword_ids and isinstance(keyword_ids, list):
                delete_erank_keyword(keyword_ids)
            elif keyword_id:
                delete_erank_keyword(keyword_id)
            else:
                self.send_error_json(400, "Silinecek ID eksik.")
                return
            self.send_success_json({"message": "Başarıyla silindi."})
        except Exception as e:
            self.send_error_json(500, "Sunucu hatası", str(e))

    def send_error_json(self, status, message, details=None):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        response_dict = {"error": message}
        if details:
            response_dict["details"] = details
        self.wfile.write(json.dumps(response_dict).encode('utf-8'))

    def send_success_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
