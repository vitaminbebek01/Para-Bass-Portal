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
            data = get_all_erank_keywords()
            self.send_success_json(data)
        except Exception as e:
            self.send_error_json(500, "Sunucu hatası", str(e))

    def do_POST(self):
        import traceback
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_json(400, "Boş veri gönderildi (Content-Length 0).")
                return

            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8')) if post_data else {}
            except Exception as json_err:
                traceback.print_exc()
                self.send_error_json(400, "Geçersiz JSON formatı.", str(json_err))
                return
            
            action = data.get('action')
            if action == 'delete':
                keyword_id = data.get('id')
                keyword_ids = data.get('ids')
                
                if keyword_ids and isinstance(keyword_ids, list):
                    # Validate strings
                    valid_ids = [str(i) for i in keyword_ids if i]
                    delete_erank_keyword(valid_ids)
                elif keyword_id:
                    delete_erank_keyword(str(keyword_id))
                else:
                    self.send_error_json(400, "Silinecek ID veya IDS eksik.")
                    return
                    
                self.send_success_json({"success": True, "message": "Başarıyla silindi."})
            else:
                self.send_error_json(400, "Geçersiz aksiyon.")
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(400, "Sunucu hatası (POST/Delete): " + str(e))

    def do_DELETE(self):
        import traceback
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_json(400, "Boş veri gönderildi (Content-Length 0).")
                return

            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8')) if post_data else {}
            except Exception as json_err:
                traceback.print_exc()
                self.send_error_json(400, "Geçersiz JSON formatı.", str(json_err))
                return
            
            keyword_id = data.get('id')
            keyword_ids = data.get('ids')
            
            if keyword_ids and isinstance(keyword_ids, list):
                valid_ids = [str(i) for i in keyword_ids if i]
                delete_erank_keyword(valid_ids)
            elif keyword_id:
                delete_erank_keyword(str(keyword_id))
            else:
                self.send_error_json(400, "Silinecek ID veya IDS eksik.")
                return
                
            self.send_success_json({"success": True, "message": "Başarıyla silindi."})
        except Exception as e:
            traceback.print_exc()
            self.send_error_json(400, "Sunucu hatası (DELETE): " + str(e))

    def send_error_json(self, status, message, details=None):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
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
