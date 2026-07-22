import sys
try:
    from supabase import create_client, Client
except ImportError:
    create_client = None
    Client = object
from etsy_hybrid_module.erank_scoring import clean_erank_records, keyword_key
try:
    from etsy_hybrid_module.config import SUPABASE_URL, SUPABASE_KEY
except ImportError:
    from .config import SUPABASE_URL, SUPABASE_KEY

# Initialize Supabase client
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY and create_client:
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
            
        # Newest rows lead so duplicate concept+keyword records collapse to the latest CSV value.
        response = query.order("id", desc=True).limit(1000).execute()
        data = clean_erank_records(response.data)
        data.sort(key=lambda item: float(item.get("score", 0) or 0), reverse=True)
        return data[:50]
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası: {e}")

def get_all_erank_keywords():
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        response = supabase.table("erank_keywords").select("*").order("id", desc=True).execute()
        data = clean_erank_records(response.data)
        data.sort(key=lambda item: float(item.get("score", 0) or 0), reverse=True)
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

def upsert_erank_keywords_for_concept(concept: str, records: list):
    """
    Preserve the existing pool. Only an exact normalized keyword in the same
    concept is updated from the new CSV; all other earlier CSV keywords remain.
    Existing duplicate copies of that exact keyword are removed.
    """
    if not supabase:
        raise Exception("Supabase bağlantı hatası: Client is not initialized.")
    try:
        existing_response = supabase.table("erank_keywords") \
            .select("id,keyword") \
            .eq("concept", concept) \
            .order("id", desc=True) \
            .execute()
        existing = existing_response.data or []
        existing_by_keyword = {}
        duplicate_ids = []
        for item in existing:
            record_id = item.get("id")
            key = keyword_key(item.get("keyword"))
            if record_id is None or not key:
                continue
            if key in existing_by_keyword:
                duplicate_ids.append(record_id)
            else:
                existing_by_keyword[key] = record_id

        inserted_records = []
        updated = 0
        for record in records:
            record_key = keyword_key(record.get("keyword"))
            existing_id = existing_by_keyword.get(record_key)
            if existing_id is None:
                inserted_records.append(record)
                continue
            supabase.table("erank_keywords").update(record).eq("id", existing_id).execute()
            updated += 1

        inserted_data = []
        if inserted_records:
            inserted_response = supabase.table("erank_keywords").insert(inserted_records).execute()
            inserted_data = inserted_response.data or []

        # Only remove redundant copies of an otherwise identical keyword.
        for start in range(0, len(duplicate_ids), 200):
            id_chunk = duplicate_ids[start:start + 200]
            if id_chunk:
                supabase.table("erank_keywords").delete().in_("id", id_chunk).execute()

        return {
            "data": inserted_data,
            "updated": updated,
            "added": len(inserted_records),
            "duplicates_removed": len(duplicate_ids),
        }
    except Exception as e:
        raise Exception(f"Supabase bağlantı hatası (eRank keyword güncellemesi): {e}")

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
