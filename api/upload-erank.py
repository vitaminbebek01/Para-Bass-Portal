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
                
                # Sütun isimlerini küçük harfe çevir ve boşlukları temizle (Bulletproof)
                if reader.fieldnames:
                    reader.fieldnames = [str(x).strip().lower() for x in reader.fieldnames if x]
                
                headers = reader.fieldnames
                print(f"DEBUG: Normalize edilmiş CSV sütunları: {headers}")
                
                records = []
                stats = {"added": 0, "rejected_single_word": 0, "rejected_low_search": 0, "rejected_high_comp": 0, "total_golden": 0}

                for row in reader:
                    # DictReader artık küçük harfli temiz anahtarlar dönecek.
                    # None olan hücre değerlerini boş stringe çevir
                    safe_row = {k: str(v).strip() if v is not None else "" for k, v in row.items()}
                    
                    keyword = safe_row.get('keywords', safe_row.get('keyword', safe_row.get('tag', '')))
                    
                    # Search Volume ve Competition
                    sv_str = safe_row.get('average searches', safe_row.get('search volume', safe_row.get('searches', '0')))
                    sv_str = sv_str.replace(',', '').replace('<', '').replace('>', '').replace(' ', '')
                    
                    comp_str = safe_row.get('competition', '0')
                    comp_str = comp_str.replace(',', '').replace('<', '').replace('>', '').replace(' ', '')
                    
                    if not keyword:
                        continue
                    
                    if len(keyword.split()) < 2:
                        stats["rejected_single_word"] += 1
                        continue

                    try:
                        sv = int(sv_str) if sv_str and sv_str.isdigit() else 0
                    except ValueError:
                        sv = 0
                        
                    try:
                        comp = int(comp_str) if comp_str and comp_str.isdigit() else 0
                    except ValueError:
                        comp = 0
                        
                    # 1. Trash Filter: sv == 0 or comp > 100000
                    if sv == 0:
                        stats["rejected_low_search"] += 1
                        continue
                    if comp > 100000:
                        stats["rejected_high_comp"] += 1
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
                import traceback
                traceback.print_exc()
                print(f"ERROR while parsing CSV: {e}")
                self.send_error_json(400, "CSV okuma hatası: " + str(e))
                return

            stats["added"] = len(records)
            result = insert_erank_keywords(records)
            self.send_success_json({
                "message": f"{len(records)} kayıt başarıyla eklendi.", 
                "data": result,
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
