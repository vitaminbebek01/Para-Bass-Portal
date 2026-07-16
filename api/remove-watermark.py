from http.server import BaseHTTPRequestHandler
import json
import os
import sys
import base64
import tempfile

# Ensure the parent directory is in sys.path to import etsy_hybrid_module
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.append(parent_dir)

from etsy_hybrid_module.watermark_remover import remove_ai_watermark

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_error_json(400, "Boş istek.")
                return

            post_data = self.rfile.read(content_length)
            data = json.loads(post_data)

            image_base64 = data.get('image', '')
            if not image_base64:
                self.send_error_json(400, "Görsel verisi bulunamadı.")
                return

            # Remove data URL scheme if present (e.g., "data:image/jpeg;base64,...")
            if "," in image_base64:
                image_base64 = image_base64.split(",")[1]

            image_data = base64.b64decode(image_base64)

            # Create temp files for input and output. Vercel functions have write access to /tmp.
            temp_in = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
            temp_out = tempfile.NamedTemporaryFile(delete=False, suffix='.jpg')
            
            temp_in.write(image_data)
            temp_in.close()
            temp_out.close()

            # Process the image with OpenCV inside etsy_hybrid_module
            success = remove_ai_watermark(temp_in.name, temp_out.name)

            if not success:
                self.send_error_json(500, "Filigran silme işlemi başarısız oldu (OpenCV hatası).")
                return

            # Read the processed image and encode back to base64
            with open(temp_out.name, 'rb') as f:
                processed_image_data = f.read()
                
            processed_base64 = base64.b64encode(processed_image_data).decode('utf-8')
            
            # Cleanup temp files
            os.unlink(temp_in.name)
            os.unlink(temp_out.name)

            self.send_success_json({"image": f"data:image/jpeg;base64,{processed_base64}"})

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
