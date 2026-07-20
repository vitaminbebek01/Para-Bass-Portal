import os

# Fallback for local development without python-dotenv
if os.path.exists(".env"):
    with open(".env", "r") as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                key, *val = line.split("=", 1)
                if val:
                    os.environ[key.strip()] = val[0].strip().strip("'\"")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Warning: Supabase credentials are missing in .env")

if not GEMINI_API_KEY:
    print("Warning: Gemini API key is missing in .env")
