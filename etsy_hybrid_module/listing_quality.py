import re


DETAIL_FIELDS = (
    "material",
    "color",
    "quantity",
    "personalization",
    "occasion",
    "packaging",
    "processing_time",
    "price",
    "stock",
    "product_notes",
)


def _text(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _tag_text(value) -> str:
    if isinstance(value, dict):
        value = value.get("keyword", "")
    return _text(value)


def calculate_listing_readiness(
    product_details: dict,
    listing: dict,
    photo_metrics: list = None,
) -> dict:
    """Return an explainable readiness score, not an Etsy ranking promise."""
    product_details = product_details or {}
    listing = listing or {}
    photo_metrics = photo_metrics or []
    warnings = []

    completed = sum(1 for field in DETAIL_FIELDS if _text(product_details.get(field)))
    product_score = round((completed / len(DETAIL_FIELDS)) * 20)
    if completed < 7:
        warnings.append("Ürün bilgilerinin bir kısmı eksik; açıklama ve Etsy taslağı zayıflayabilir.")

    title = _text(listing.get("title"))
    tags = [_tag_text(tag) for tag in listing.get("tags", []) if _tag_text(tag)]
    description = _text(listing.get("description"))
    unique_tags = {tag.casefold() for tag in tags}
    search_score = 0
    if title and len(title) <= 140:
        search_score += 7
    if title and len(title.split()) <= 15:
        search_score += 3
    else:
        warnings.append("Başlığı mümkünse 15 kelimenin altında ve daha taranabilir tutun.")
    if len(tags) == 13 and len(unique_tags) == 13 and all(len(tag) <= 20 for tag in tags):
        search_score += 10
    else:
        warnings.append("13 benzersiz ve 20 karakteri aşmayan etiket şartı sağlanmıyor.")
    if len(description) >= 500:
        search_score += 5
    else:
        warnings.append("Açıklama ürünün faydasını ve ayrıntılarını yeterince kapsamıyor.")

    category_score = 0
    if _text(listing.get("category_suggestion")):
        category_score += 8
    else:
        warnings.append("Etsy kategori önerisi eksik.")
    attributes = listing.get("attributes", [])
    if isinstance(attributes, list) and len(attributes) >= 2:
        category_score += 7
    else:
        warnings.append("Renk, malzeme veya kullanım gibi Etsy özellikleri eksik.")

    photo_score = 0
    if photo_metrics:
        photo_score += 7
        first = photo_metrics[0]
        brightness = float(first.get("brightness", 0) or 0)
        sharpness = float(first.get("sharpness", 0) or 0)
        if 55 <= brightness <= 220:
            photo_score += 6
        else:
            warnings.append("Ana fotoğraf çok karanlık veya fazla parlak görünüyor.")
        if sharpness >= 10:
            photo_score += 6
        else:
            warnings.append("Ana fotoğraf bulanık olabilir; daha net bir çekim kullanın.")
        if len(photo_metrics) >= 5:
            photo_score += 6
        else:
            photo_score += min(len(photo_metrics), 4)
            warnings.append("Ürünü daha iyi anlatmak için en az 5 gerçek fotoğraf önerilir.")
    else:
        warnings.append("Gerçek ürün fotoğrafı eklenmedi.")

    trust_score = 0
    if _text(product_details.get("processing_time")):
        trust_score += 4
    if _text(product_details.get("packaging")):
        trust_score += 4
    if _text(product_details.get("personalization")):
        trust_score += 3
    if _text(product_details.get("product_notes")):
        trust_score += 4
    if trust_score < 10:
        warnings.append("Hazırlık, paketleme ve kişiselleştirme bilgilerini doğrulayın.")

    breakdown = {
        "product_information": min(product_score, 20),
        "search_relevance": min(search_score, 25),
        "category_attributes": min(category_score, 15),
        "photo_quality": min(photo_score, 25),
        "policy_trust": min(trust_score, 15),
    }
    score = sum(breakdown.values())
    label = "Hazır" if score >= 85 else ("İyi" if score >= 70 else ("Geliştirilmeli" if score >= 50 else "Eksik"))
    return {
        "score": score,
        "label": label,
        "breakdown": breakdown,
        "warnings": warnings,
        "disclaimer": "Bu puan Etsy sıralama garantisi değil, listeleme hazırlık kontrolüdür.",
    }
