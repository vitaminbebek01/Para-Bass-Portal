from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import csv
import io

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.db_handler import insert_erank_keywords

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)
            
            concept = data.get('concept')
            csv_content = data.get('csv_content')
            
            if not concept or not csv_content:
                self.send_error_json(400, "Concept and csv_content are required.")
                return

            # Parse CSV
            f = io.StringIO(csv_content)
            reader = csv.DictReader(f)
            
            records = []
            for row in reader:
                # Find the correct column names by checking lower case
                row_lower = {k.strip().lower() if k else '': v for k, v in row.items()}
                
                keyword = row_lower.get('keyword', '')
                
                # Search Volume could be 'search volume', 'avg searches', etc.
                sv_str = row_lower.get('search volume', '0').replace(',', '')
                # Competition could be 'competition'
                comp_str = row_lower.get('competition', '0').replace(',', '')
                
                if not keyword:
                    continue
                    
                try:
                    sv = int(sv_str) if sv_str.isdigit() else 0
                except ValueError:
                    sv = 0
                    
                try:
                    comp = int(comp_str) if comp_str.isdigit() else 0
                except ValueError:
                    comp = 0
                    
                score = sv / comp if comp > 0 else sv
                
                records.append({
                    "category": concept,
                    "keyword": keyword,
                    "search_volume": sv,
                    "score": float(score)
                })

            if not records:
                self.send_error_json(400, "CSV parse edilemedi veya geçerli veri bulunamadı.")
                return

            # Try to insert with score column first
            result = insert_erank_keywords(records)
            if isinstance(result, dict) and "error" in result:
                # If 'score' column doesn't exist in Supabase, fallback to mapping score to search_volume
                safe_records = [{"category": r["category"], "keyword": r["keyword"], "search_volume": int(r["score"])} for r in records]
                result_fallback = insert_erank_keywords(safe_records)
                
                if isinstance(result_fallback, dict) and "error" in result_fallback:
                    self.send_error_json(500, result_fallback["error"])
                else:
                    self.send_success_json({"message": f"{len(safe_records)} kayıt başarıyla skorlanarak eklendi.", "data": result_fallback})
            else:
                self.send_success_json({"message": f"{len(records)} kayıt başarıyla eklendi.", "data": result})

        except Exception as e:
            self.send_error_json(500, str(e))

    def send_error_json(self, status, message):
        self.send_response(status)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps({"error": message}).encode('utf-8'))

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
