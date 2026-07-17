from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.db_handler import get_erank_keywords, check_cached_seo
from etsy_hybrid_module.gemini_rag_engine import generate_optimized_listing

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_json(400, "Boş istek.")
                return

            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)

            product_type = data.get('product_type', '')
            concept = data.get('concept', '')
            keyword = data.get('keyword', '')
            product_size = data.get('product_size', '')
            box_size = data.get('box_size', '')
            
            # Form search term for caching/fallback
            base_category = f"{product_type} {concept}".strip()
            search_term = keyword if keyword else base_category

            if not base_category:
                self.send_error_json(400, "Ürün tipi veya konsept seçilmelidir.")
                return
            
            # 1. Check cache first (saves LLM tokens & time)
            cached = check_cached_seo(search_term)
            if cached:
                self.send_success_json(cached)
                return

            # 2. Fetch high volume keywords from eRank DB using the concept as category tag
            erank_data = get_erank_keywords(concept if concept else product_type)
            keywords_list = [item.get('keyword') for item in erank_data] if erank_data else [search_term]

            # 3. Generate listing using Gemini RAG Engine
            pdf_path = os.path.join(os.getcwd(), "Etsy_2026_Algoritma_Rehberi.pdf")
            result = generate_optimized_listing(keywords_list, pdf_path, product_type, product_size, box_size)

            if "error" in result:
                self.send_error_json(500, result["error"])
                return

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
        # Handle CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        response_dict = {"error": message}
        if details:
            response_dict["details"] = details
        self.wfile.write(json.dumps(response_dict).encode('utf-8'))

    def send_success_json(self, data):
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        # Handle CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    def do_OPTIONS(self):
        # Handle CORS preflight request
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
