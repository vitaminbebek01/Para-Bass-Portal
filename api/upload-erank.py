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
            try:
                # Clean BOM if exists
                csv_content = csv_content.encode('utf-8').decode('utf-8-sig')
                
                f = io.StringIO(csv_content)
                reader = csv.DictReader(f)
                headers = reader.fieldnames
                print(f"DEBUG: Okunan CSV sütunları: {headers}")
                
                records = []
                stats = {"total_scanned": 0, "total_filtered": 0, "total_golden": 0, "total_added": 0}

                for row in reader:
                    # Find the correct column names by checking lower case
                    row_lower = {str(k).strip().lower() if k else '': str(v).strip() for k, v in row.items()}
                    
                    keyword = row_lower.get('keywords', row_lower.get('keyword', ''))
                    
                    # Search Volume could be 'average searches', 'search volume', etc.
                    sv_str = row_lower.get('average searches', row_lower.get('search volume', '0')).replace(',', '')
                    # Competition could be 'competition'
                    comp_str = row_lower.get('competition', '0').replace(',', '')
                    
                    if not keyword:
                        continue
                    
                    stats["total_scanned"] += 1

                    try:
                        sv = int(sv_str) if sv_str.isdigit() else 0
                    except ValueError:
                        sv = 0
                        
                    try:
                        comp = int(comp_str) if comp_str.isdigit() else 0
                    except ValueError:
                        comp = 0
                        
                    # 1. Trash Filter: sv == 0 or comp > 100000
                    if sv == 0 or comp > 100000:
                        stats["total_filtered"] += 1
                        continue
                        
                    # 2. Score Calculation and Golden Tag Boost
                    base_score = sv / comp if comp > 0 else sv
                    
                    if comp < 10000 and sv > 250:
                        score = base_score + 10000  # Golden Boost
                        stats["total_golden"] += 1
                    else:
                        score = base_score
                        
                    records.append({
                        "concept": concept,
                        "keyword": keyword,
                        "score": float(score),
                        "searches": sv,
                        "competition": comp
                    })

                if not records:
                    error_msg = f"Okunan sütunlar: {headers}"
                    print(f"ERROR: CSV parse edilemedi veya geçerli veri bulunamadı. {error_msg}")
                    self.send_error_json(400, "CSV başarıyla tarandı ancak eklenecek geçerli/kaliteli veri bulunamadı.", error_msg)
                    return

            except Exception as e:
                print(f"ERROR while parsing CSV: {e}")
                self.send_error_json(400, "CSV okuma hatası", str(e))
                return

            stats["total_added"] = len(records)
            result = insert_erank_keywords(records)
            self.send_success_json({
                "message": f"{len(records)} kayıt başarıyla eklendi.", 
                "data": result,
                "stats": stats
            })

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
