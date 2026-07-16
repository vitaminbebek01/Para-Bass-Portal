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
    """
    Fetch the highest search volume keywords from the 'erank_data' table based on category.
    """
    if not supabase:
        print("Warning: Supabase client is not initialized.")
        return []
    try:
        response = supabase.table("erank_data") \
            .select("*") \
            .eq("category", category) \
            .order("search_volume", desc=True) \
            .limit(10) \
            .execute()
        return response.data
    except Exception as e:
        print(f"Error fetching erank keywords for category '{category}': {e}")
        return []

def get_prompt_pool():
    """
    Fetch fixed photo prompt templates from the 'prompt_pool' table.
    """
    if not supabase:
        print("Warning: Supabase client is not initialized.")
        return []
    try:
        response = supabase.table("prompt_pool").select("*").execute()
        return response.data
    except Exception as e:
        print(f"Error fetching prompt pool: {e}")
        return []

def check_cached_seo(category_id: str):
    """
    Check if SEO text has been generated previously for a category to save LLM tokens.
    """
    if not supabase:
        print("Warning: Supabase client is not initialized.")
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
