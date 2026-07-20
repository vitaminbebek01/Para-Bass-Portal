import http.server
import socketserver
import os
import sys
import importlib.util
from urllib.parse import urlparse

PORT = 8000
API_DIR = "api"

class LocalHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/'):
            self.handle_api()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            self.handle_api()
        else:
            self.send_error(405)

    def do_DELETE(self):
        if self.path.startswith('/api/'):
            self.handle_api()
        else:
            self.send_error(405)

    def handle_api(self):
        parsed_path = urlparse(self.path)
        script_name = parsed_path.path.split('/')[-1]
        script_path = os.path.join(API_DIR, f"{script_name}.py")

        if os.path.exists(script_path):
            try:
                # Dinamik olarak API dosyasını yükle
                spec = importlib.util.spec_from_file_location("api_module", script_path)
                api_module = importlib.util.module_from_spec(spec)
                sys.modules["api_module"] = api_module
                spec.loader.exec_module(api_module)
                
                # Handler sınıfından instance oluştur (Bu sınıf BaseHTTPRequestHandler kullanıyor, ancak biz kendi handler'ımızı yönlendiriyoruz)
                # Bu yüzden handler init edilirken bizim self (BaseHTTPRequestHandler) objemizi argüman veriyoruz
                handler_instance = api_module.handler(self.request, self.client_address, self.server)
            except Exception as e:
                # Eger BaseHTTPRequestHandler constructor'i cagriliyorsa socket hatasi atabilir, 
                # cünkü stream'i tekrar okumaya calisiyor olabilir.
                pass
        else:
            self.send_error(404, "API endpoint not found")

with socketserver.TCPServer(("", PORT), LocalHandler) as httpd:
    print(f"Lokal sunucu başlatıldı: http://localhost:{PORT}")
    print("Durdurmak için Ctrl+C'ye basın.")
    httpd.serve_forever()
