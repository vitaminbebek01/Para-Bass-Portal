import sys
from supabase import create_client, Client
try:
    from etsy_hybrid_module.config import SUPABASE_URL, SUPABASE_KEY
except ImportError:
    from .config import SUPABASE_URL, SUPABASE_KEY

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Error initializing Supabase client: {e}")

def get_erank_keywords(concept):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        query = supabase.table("erank_keywords").select("*")
        
        if isinstance(concept, list):
            query = query.in_("concept", concept)
        else:
            query = query.eq("concept", concept)
            
        response = query.order("score", desc=True).limit(50).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def get_all_erank_keywords(limit=200):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("erank_keywords").select("*").order("score", desc=True).limit(limit).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def delete_erank_keyword(keyword_id):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("erank_keywords").delete().eq("id", keyword_id).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def insert_erank_keywords(records: list):
    """
    Inserts a list of dicts into erank_keywords.
    Example record: {"concept": "Wedding", "keyword": "wedding gift", "score": 1000}
    """
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("erank_keywords").insert(records).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def get_prompt_pool():
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").select("*").order("id").execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def add_prompt(content: str):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").insert({"content": content}).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def update_prompt(prompt_id: int, content: str):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").update({"content": content}).eq("id", prompt_id).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def delete_prompt(prompt_id: int):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").delete().eq("id", prompt_id).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

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
