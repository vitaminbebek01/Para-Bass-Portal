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

def get_all_erank_keywords():
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        # Fetching all without .limit() to get the maximum allowed by Supabase
        response = supabase.table("erank_keywords").select("*").order("score", desc=True).execute()
        data = response.data
        if data:
            # Filter out single words as per request
            data = [item for item in data if " " in str(item.get("keyword", "")).strip()]
        return data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def delete_erank_keyword(keyword_id_or_ids):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        if isinstance(keyword_id_or_ids, list):
            # Fast delete with .in_()
            response = supabase.table("erank_keywords").delete().in_("id", keyword_id_or_ids).execute()
            return response.data
        else:
            response = supabase.table("erank_keywords").delete().eq("id", str(keyword_id_or_ids)).execute()
            return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası (delete_erank_keyword): {e}")

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
        response = supabase.table("prompt_pool").select("*").order("created_at", desc=True).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def add_prompt(title: str, prompt_text: str, new_id: str):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").insert({"id": new_id, "title": title, "prompt_text": prompt_text}).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def update_prompt(prompt_id: str, title: str, prompt_text: str):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").update({"title": title, "prompt_text": prompt_text}).eq("id", str(prompt_id)).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası (update_prompt): {e}")

def delete_prompt(prompt_id: str):
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("prompt_pool").delete().eq("id", str(prompt_id)).execute()
        return response.data
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası (delete_prompt): {e}")

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
