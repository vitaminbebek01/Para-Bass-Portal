import sys
from supabase import create_client, Client
try:
    from .config import SUPABASE_URL, SUPABASE_KEY
except ImportError:
    from config import SUPABASE_URL, SUPABASE_KEY

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Error initializing Supabase client: {e}")

def get_erank_keywords(category: str):
    if not supabase:
        print("Warning: Supabase client is not initialized.")
        return []
    try:
        response = supabase.table("erank_data") \
            .select("*") \
            .eq("category", category) \
            .order("search_volume", desc=True) \
            .limit(15) \
            .execute()
        return response.data
    except Exception as e:
        print(f"Error fetching erank keywords for category '{category}': {e}")
        return []

def insert_erank_keywords(records: list):
    """
    Inserts a list of dicts into erank_data.
    Example record: {"category": "Wedding", "keyword": "wedding gift", "search_volume": 1000}
    """
    if not supabase:
        return {"error": "Supabase client is not initialized"}
    try:
        response = supabase.table("erank_data").insert(records).execute()
        return response.data
    except Exception as e:
        return {"error": str(e)}

def get_prompt_pool():
    if not supabase:
        print("Warning: Supabase client is not initialized.")
        return []
    try:
        # Assuming table has 'id' and 'content' columns.
        response = supabase.table("prompt_pool").select("*").order("id").execute()
        return response.data
    except Exception as e:
        print(f"Error fetching prompt pool: {e}")
        return []

def add_prompt(content: str):
    if not supabase:
        return {"error": "Supabase is missing"}
    try:
        response = supabase.table("prompt_pool").insert({"content": content}).execute()
        return response.data
    except Exception as e:
        return {"error": str(e)}

def update_prompt(prompt_id: int, content: str):
    if not supabase:
        return {"error": "Supabase is missing"}
    try:
        response = supabase.table("prompt_pool").update({"content": content}).eq("id", prompt_id).execute()
        return response.data
    except Exception as e:
        return {"error": str(e)}

def delete_prompt(prompt_id: int):
    if not supabase:
        return {"error": "Supabase is missing"}
    try:
        response = supabase.table("prompt_pool").delete().eq("id", prompt_id).execute()
        return response.data
    except Exception as e:
        return {"error": str(e)}

def check_cached_seo(category_id: str):
    if not supabase:
        return None
    try:
        response = supabase.table("seo_cache") \
            .select("*") \
            .eq("category_id", category_id) \
            .execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0]
        return None
    except Exception as e:
        print(f"Error checking cached SEO for category '{category_id}': {e}")
        return None
