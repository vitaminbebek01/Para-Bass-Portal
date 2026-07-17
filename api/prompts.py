from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.db_handler import get_prompt_pool, add_prompt, update_prompt, delete_prompt

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            data = get_prompt_pool()
            self.send_success_json(data)
        except Exception as e:
            err_str = str(e)
            if "Supabase" in err_str:
                self.send_error_json(500, "Supabase bağlantı hatası", err_str)
            else:
                self.send_error_json(500, "Sunucu hatası", err_str)

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            content = data.get('content')
            if not content:
                self.send_error_json(400, "Content is required.")
                return

            result = add_prompt(content)
            if isinstance(result, dict) and "error" in result:
                self.send_error_json(500, result["error"])
            else:
                self.send_success_json(result)
        except Exception as e:
            err_str = str(e)
            if "Supabase" in err_str:
                self.send_error_json(500, "Supabase bağlantı hatası", err_str)
            else:
                self.send_error_json(500, "Sunucu hatası", err_str)

    def do_PUT(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            prompt_id = data.get('id')
            content = data.get('content')
            
            if not prompt_id or not content:
                self.send_error_json(400, "ID and Content are required.")
                return

            result = update_prompt(prompt_id, content)
            if isinstance(result, dict) and "error" in result:
                self.send_error_json(500, result["error"])
            else:
                self.send_success_json(result)
        except Exception as e:
            err_str = str(e)
            if "Supabase" in err_str:
                self.send_error_json(500, "Supabase bağlantı hatası", err_str)
            else:
                self.send_error_json(500, "Sunucu hatası", err_str)

    def do_DELETE(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            prompt_id = data.get('id')
            
            if not prompt_id:
                self.send_error_json(400, "ID is required.")
                return

            result = delete_prompt(prompt_id)
            if isinstance(result, dict) and "error" in result:
                self.send_error_json(500, result["error"])
            else:
                self.send_success_json(result)
        except Exception as e:
            err_str = str(e)
            if "Supabase" in err_str:
                self.send_error_json(500, "Supabase bağlantı hatası", err_str)
            else:
                self.send_error_json(500, "Sunucu hatası", err_str)

    def send_error_json(self, status, message, details=None):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
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
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
