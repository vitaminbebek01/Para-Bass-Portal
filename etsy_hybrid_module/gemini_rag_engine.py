import json
import os
import re
import unicodedata
from functools import lru_cache

try:
    import google.generativeai as genai
except ImportError:
    genai = None

try:
    from etsy_hybrid_module.config import GEMINI_API_KEY
except ImportError:
    from .config import GEMINI_API_KEY


MAX_TITLE_LENGTH = 140
SHORT_TITLE_LENGTH = 70
MAIN_TAG_COUNT = 13
BACKUP_TAG_COUNT = 10
MAX_TAG_LENGTH = 20

_CONNECTOR_WORDS = {
    "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "&"
}
_TAG_STOP_WORDS = _CONNECTOR_WORDS | {"your"}


if GEMINI_API_KEY and genai:
    genai.configure(api_key=GEMINI_API_KEY)
elif not GEMINI_API_KEY:
    print("Warning: Gemini API key not found. RAG Engine will not work properly.")


def normalize_text(value) -> str:
    """Trim text and collapse repeated whitespace without changing word order."""
    return re.sub(r"\s+", " ", str(value or "")).strip()


def comparison_key(value) -> str:
    """Create a Unicode- and case-insensitive key used only for comparisons."""
    return unicodedata.normalize("NFKC", normalize_text(value)).casefold()


def _tag_text(value) -> str:
    if isinstance(value, dict):
        value = value.get("keyword", "")
    return normalize_text(value)


def _meaningful_tokens(value) -> set:
    normalized = unicodedata.normalize("NFKC", normalize_text(value)).casefold()
    return {
        token
        for token in re.findall(r"[\w']+", normalized, flags=re.UNICODE)
        if len(token) >= 3 and token not in _TAG_STOP_WORDS
    }


@lru_cache(maxsize=1)
def load_compact_rules(rules_path: str) -> str:
    if not os.path.exists(rules_path):
        raise FileNotFoundError(f"Kısa Etsy kuralları dosyası bulunamadı: {rules_path}")
    with open(rules_path, "r", encoding="utf-8") as rules_file:
        rules = rules_file.read().strip()
    if not rules:
        raise ValueError("Kısa Etsy kuralları dosyası boş.")
    return rules


def prepare_locked_tags(locked_tags: list = None) -> list:
    """
    Normalize whitespace for display, but preserve the first selected casing,
    punctuation and word order. Equivalent duplicates are rejected.
    """
    prepared = []
    seen = set()
    for raw_tag in locked_tags or []:
        tag = _tag_text(raw_tag)
        if not tag:
            continue
        if len(tag) > MAX_TAG_LENGTH:
            raise ValueError(f"Kilitli etiket 20 karakteri aşıyor ve değiştirilemez: '{tag}'")
        key = comparison_key(tag)
        if key in seen:
            raise ValueError(f"Aynı kilitli etiket birden fazla seçilmiş: '{tag}'")
        seen.add(key)
        prepared.append(tag)

    if len(prepared) > MAIN_TAG_COUNT:
        raise ValueError("En fazla 13 kilitli etiket seçilebilir.")
    return prepared


def _clean_title(title: str) -> str:
    title = normalize_text(title)
    title = re.sub(r"\s+([,;|])", r"\1", title)
    title = re.sub(r"([,;|])(?:\s*\1)+", r"\1", title)
    title = re.sub(r"\s*([,;|])\s*", r"\1 ", title)

    # Remove exact duplicate comma/pipe/semicolon sections, preserving the first.
    sections = [part.strip(" ,;|") for part in re.split(r"[,;|]", title)]
    if len(sections) > 1:
        unique_sections = []
        seen_sections = set()
        for section in sections:
            if not section:
                continue
            key = comparison_key(section)
            if key not in seen_sections:
                seen_sections.add(key)
                unique_sections.append(section)
        title = ", ".join(unique_sections)

    # Remove only immediately repeated words; do not guess at semantic rewrites.
    words = title.split()
    cleaned_words = []
    previous_key = None
    for word in words:
        word_key = comparison_key(word.strip(" ,;:|.!?"))
        if word_key and word_key == previous_key:
            continue
        cleaned_words.append(word)
        previous_key = word_key
    return " ".join(cleaned_words).strip(" ,;:|-")


def _remove_dangling_connector(text: str) -> str:
    words = text.rstrip(" ,;:|-–—").split()
    while words and comparison_key(words[-1].strip(" ,;:|.!?")) in _CONNECTOR_WORDS:
        words.pop()
    return " ".join(words).rstrip(" ,;:|-–—")


def shorten_at_word_boundary(text: str, limit: int) -> str:
    text = normalize_text(text)
    if len(text) <= limit:
        return _remove_dangling_connector(text)

    prefix = text[: limit + 1]
    boundary = prefix.rfind(" ")
    if boundary <= 0:
        raise ValueError(f"Başlık {limit} karaktere kelime bütünlüğü korunarak indirilemiyor.")

    shortened = _remove_dangling_connector(prefix[:boundary])
    if not shortened:
        raise ValueError(f"Başlık {limit} karaktere güvenli biçimde indirilemiyor.")
    return shortened


def finalize_full_title(raw_title: str) -> str:
    title = _clean_title(raw_title)
    if not title:
        raise ValueError("Gemini geçerli bir başlık üretmedi.")
    if len(title) > MAX_TITLE_LENGTH:
        title = shorten_at_word_boundary(title, MAX_TITLE_LENGTH)
    if not title or len(title) > MAX_TITLE_LENGTH:
        raise ValueError("Tam başlık 140 karakter sınırına güvenli biçimde indirilemedi.")
    return title


def build_short_title(full_title: str) -> str:
    short_title = shorten_at_word_boundary(full_title, SHORT_TITLE_LENGTH)
    if len(short_title) > SHORT_TITLE_LENGTH:
        raise ValueError("Kısa başlık 70 karakter sınırını aşıyor.")
    return short_title


def _is_relevant_tag(tag: str, erank_keys: set, context_tokens: set) -> bool:
    key = comparison_key(tag)
    if key in erank_keys:
        return True
    tag_tokens = _meaningful_tokens(tag)
    return bool(tag_tokens and tag_tokens.intersection(context_tokens))


def _tag_object(tag: str, erank_lookup: dict) -> dict:
    source = erank_lookup.get(comparison_key(tag))
    if source:
        return {
            "keyword": tag,
            "searches": int(source.get("searches", 0) or 0),
            "competition": int(source.get("competition", 0) or 0),
        }
    return {"keyword": tag, "searches": 0, "competition": 0}


def validate_and_finalize_listing(
    result: dict,
    category_keywords_objs: list,
    product_type: str = "",
    selected_concepts: list = None,
    custom_keyword: str = "",
    locked_tags: list = None,
) -> dict:
    """Validate Gemini output and deterministically build safe title/tag fields."""
    if not isinstance(result, dict):
        raise ValueError("Gemini sonucu geçerli bir JSON nesnesi değil.")

    prepared_locked = prepare_locked_tags(locked_tags)
    full_title = finalize_full_title(result.get("title", ""))
    short_title = build_short_title(full_title)

    erank_lookup = {}
    for item in category_keywords_objs or []:
        keyword = _tag_text(item)
        if keyword and len(keyword) <= MAX_TAG_LENGTH:
            erank_lookup.setdefault(comparison_key(keyword), item)
    erank_keys = set(erank_lookup)

    context_values = [product_type, custom_keyword]
    context_values.extend(selected_concepts or [])
    context_values.extend(prepared_locked)
    context_tokens = set()
    for value in context_values:
        context_tokens.update(_meaningful_tokens(value))

    main_tags = []
    used_keys = set()

    def append_tag(tag, require_relevance=True):
        tag = _tag_text(tag)
        if not tag or len(tag) > MAX_TAG_LENGTH:
            return False
        key = comparison_key(tag)
        if key in used_keys:
            return False
        if require_relevance and not _is_relevant_tag(tag, erank_keys, context_tokens):
            return False
        main_tags.append(_tag_object(tag, erank_lookup))
        used_keys.add(key)
        return True

    # Locked tags always lead the list and retain the user's normalized display form.
    for tag in prepared_locked:
        append_tag(tag, require_relevance=False)

    generated_tags = result.get("tags", [])
    generated_backup = result.get("backup_tags", [])
    if not isinstance(generated_tags, list):
        generated_tags = []
    if not isinstance(generated_backup, list):
        generated_backup = []

    # Keep valid Gemini main tags, then fill from backups, then selected-concept eRank data.
    for candidate_pool in (generated_tags, generated_backup, list(erank_lookup.values())):
        for candidate in candidate_pool:
            if len(main_tags) >= MAIN_TAG_COUNT:
                break
            append_tag(candidate)
        if len(main_tags) >= MAIN_TAG_COUNT:
            break

    if len(main_tags) != MAIN_TAG_COUNT:
        raise ValueError(
            f"Ürünle ilgili, benzersiz ve 20 karakteri aşmayan 13 etiket oluşturulamadı "
            f"({len(main_tags)}/13)."
        )

    # Preserve the backup_tags field with safe, relevant alternatives not used in main tags.
    backup_tags = []
    backup_keys = set(used_keys)
    for candidate_pool in (generated_backup, list(erank_lookup.values()), generated_tags):
        for candidate in candidate_pool:
            tag = _tag_text(candidate)
            key = comparison_key(tag)
            if (
                not tag
                or len(tag) > MAX_TAG_LENGTH
                or key in backup_keys
                or not _is_relevant_tag(tag, erank_keys, context_tokens)
            ):
                continue
            backup_tags.append(_tag_object(tag, erank_lookup))
            backup_keys.add(key)
            if len(backup_tags) >= BACKUP_TAG_COUNT:
                break
        if len(backup_tags) >= BACKUP_TAG_COUNT:
            break

    finalized = dict(result)
    finalized["title"] = full_title
    finalized["short_title"] = short_title
    finalized["tags"] = main_tags
    finalized["backup_tags"] = backup_tags[:BACKUP_TAG_COUNT]
    finalized["description"] = str(result.get("description", ""))
    return finalized


def build_listing_prompt(
    category_keywords_objs: list,
    rules_path: str,
    product_type: str = "",
    product_size: str = "",
    box_size: str = "",
    locked_tags: list = None,
    selected_concepts: list = None,
    custom_keyword: str = "",
    product_details: dict = None,
) -> str:
    compact_rules = load_compact_rules(rules_path)
    prepared_locked = prepare_locked_tags(locked_tags)
    concepts = [normalize_text(item) for item in (selected_concepts or []) if normalize_text(item)]
    custom_keyword = normalize_text(custom_keyword)
    product_details = {
        str(key): normalize_text(value)
        for key, value in (product_details or {}).items()
        if normalize_text(value)
    }

    strict_rules = (
        "CRITICAL RULES YOU MUST FOLLOW EXACTLY (DO NOT DEVIATE):\n"
        "1. LANGUAGE: Every generated word (Title, Tags, Description) MUST BE 100% in English. Absolutely no Turkish.\n"
        "2. TITLE: Return one natural full title in the 'title' field. It MUST be 140 characters or fewer. "
        "The source guide's 70-character recommendation is only for the separate short UI preview and MUST NOT limit the full title. "
        "Prefer a clear, buyer-friendly title of 15 words or fewer; do not fill 140 characters unnecessarily. "
        "Do not repeat words unnecessarily.\n"
    )

    if prepared_locked:
        strict_rules += (
            f"3. LOCKED TAGS (CRITICAL): Use these {len(prepared_locked)} tags exactly as written, without shortening, "
            f"reordering words, changing casing or replacing them: {json.dumps(prepared_locked, ensure_ascii=False)}. "
            f"Fill the remaining {MAIN_TAG_COUNT - len(prepared_locked)} slots with relevant tags.\n"
        )
    else:
        strict_rules += (
            "3. ORGANIC SEO WIRING: Select exactly 13 relevant long-tail tags and use important phrases naturally "
            "in the title and opening description without keyword stuffing.\n"
        )

    if product_type.strip().lower() in ["candle", "mum"]:
        strict_rules += (
            "4. KOKUSUZ MUM KURALI (CANDLE): DO NOT use 'Unscented', 'scented', 'smell', 'fragrance', or 'aroma' "
            "anywhere. Do not mention materials such as soy wax or beeswax.\n"
        )
    else:
        strict_rules += "4. MATERIAL: You may naturally include material information if it enhances the premium feel.\n"

    dimensions = []
    if normalize_text(product_size):
        dimensions.append(f"Product Size: {normalize_text(product_size)}")
    if normalize_text(box_size):
        dimensions.append(f"Box Size: {normalize_text(box_size)}")
    if dimensions:
        strict_rules += f"5. DIMENSIONS: Use EXACTLY these dimensions: {', '.join(dimensions)}.\n"
    else:
        strict_rules += "5. DIMENSIONS: DO NOT invent any dimensions.\n"

    strict_rules += (
        "6. PACKAGING (STRICT): The packaging options MUST be written EXACTLY as: 'White Box, Kraft Box, Clear Bag'. "
        "DO NOT offer or mention any other packaging or colors.\n"
        "7. CARE INSTRUCTIONS: DO NOT write any care instructions.\n"
        "8. SHIPPING: The shipping section MUST contain EXACTLY this text, word for word:\n"
        "'Ready to ship in 1-5 business days. Standard and express shipping options are available at checkout.'\n"
        "9. FIXED SIGNATURE: Every description MUST end with EXACTLY this signature block:\n\n"
        "❤Please visit our shop for other party favors, you will love them ❤:\n"
        "➢ https://www.etsy.com/shop/EynisaPartyFavors\n\n"
        "I'll always be adding new pieces to my shop, so be sure to heart my shop.\n"
        "If you have any questions , please write me :)\n"
        "Thank you :)\n\n"
        "10. PREMIUM TONE: The description must feel aesthetic, luxurious and elegant. Include a 'Perfect for:' "
        "bulleted list covering the selected concepts."
    )

    concepts_section = ""
    if concepts:
        concepts_section = "SEÇİLEN KONSEPTLER (TÜMÜNÜ DİKKATE AL):\n" + "\n".join(
            f"- {concept}" for concept in concepts
        ) + "\n\n"

    custom_keyword_section = ""
    if custom_keyword:
        custom_keyword_section = (
            "KULLANICININ ÖZEL ANAHTAR KELİMESİ (ÜRÜNLE UYUMLUYSA DOĞAL KULLAN):\n"
            f"- {custom_keyword}\n\n"
        )

    product_details_section = ""
    if product_details:
        product_details_section = (
            "KULLANICININ DOĞRULADIĞI ÜRÜN BİLGİLERİ (BUNLARI DEĞİŞTİRME VE YENİ BİLGİ UYDURMA):\n"
            f"{json.dumps(product_details, ensure_ascii=False, indent=2)}\n\n"
        )

    category_keywords = [_tag_text(obj) for obj in category_keywords_objs or [] if _tag_text(obj)]
    return (
        f"KISA ETSY KURALLARI:\n{compact_rules}\n\n"
        f"{concepts_section}"
        f"{custom_keyword_section}"
        f"{product_details_section}"
        f"ERANK KELİMELERİ (YALNIZCA ÜRÜNLE İLGİLİ OLANLARI SEÇ):\n{category_keywords}\n\n"
        f"{strict_rules}\n\n"
        "Aşağıdaki mevcut JSON yapısını kullanarak yalnızca geçerli JSON döndür:\n"
        "- 'title' (string, full title, maximum 140 characters)\n"
        "- 'tags' (array of exactly 13 strings, each maximum 20 characters)\n"
        "- 'backup_tags' (array of exactly 10 strings, each maximum 20 characters)\n"
        "- 'description' (string)\n"
        "- 'category_suggestion' (string; Etsy category suggestion, not an invented fact)\n"
        "- 'attributes' (array of short strings based only on confirmed details or clearly visible photo evidence)\n"
        "- 'image_observations' (array of short strings describing only clearly visible product traits)\n"
        "- 'photo_order' (array of short suggestions for arranging the user's real product photos)\n"
        "- 'uncertain_fields' (array of details the user should verify; never guess them)"
    )


def generate_optimized_listing(
    category_keywords_objs: list,
    rules_path: str,
    product_type: str = "",
    product_size: str = "",
    box_size: str = "",
    locked_tags: list = None,
    selected_concepts: list = None,
    custom_keyword: str = "",
    product_details: dict = None,
    image_parts: list = None,
) -> dict:
    """Generate an Etsy listing using compact rules, then validate the result locally."""
    try:
        prepared_locked = prepare_locked_tags(locked_tags)
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is missing. Cannot call Gemini API.")
        if genai is None:
            raise ValueError("google-generativeai paketi eksik. Gemini API çağrısı yapılamaz.")

        prompt = build_listing_prompt(
            category_keywords_objs,
            rules_path,
            product_type,
            product_size,
            box_size,
            prepared_locked,
            selected_concepts,
            custom_keyword,
            product_details,
        )
        system_instruction = (
            "Sen deneyimli bir Etsy SEO uzmanısın. Verilen konseptleri, özel anahtar kelimeyi, eRank verilerini "
            "ve ürün özelliklerini kullanarak %100 İngilizce, doğal ve premium bir listeleme üret."
        )
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"},
        )
        content = [prompt]
        content.extend(image_parts or [])
        response = model.generate_content(content)
        result = json.loads(response.text)
        finalized = validate_and_finalize_listing(
            result,
            category_keywords_objs,
            product_type,
            selected_concepts,
            custom_keyword,
            prepared_locked,
        )
        for field in ("attributes", "image_observations", "photo_order", "uncertain_fields"):
            value = finalized.get(field, [])
            finalized[field] = [
                normalize_text(item) for item in value if normalize_text(item)
            ] if isinstance(value, list) else []
        finalized["category_suggestion"] = normalize_text(finalized.get("category_suggestion"))
        return finalized
    except Exception as exc:
        print(f"Error generating optimized listing: {exc}")
        return {"error": str(exc)}
