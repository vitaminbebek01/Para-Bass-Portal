import os
import json
import google.generativeai as genai
import PyPDF2
try:
    from etsy_hybrid_module.config import GEMINI_API_KEY
except ImportError:
    from .config import GEMINI_API_KEY

# Configure Gemini
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
else:
    print("Warning: Gemini API key not found. RAG Engine will not work properly.")

def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Extracts text from the provided PDF file.
    """
    try:
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found at path: {pdf_path}")
            
        text = ""
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            for page in reader.pages:
                extracted = page.extract_text()
                if extracted:
                    text += extracted + "\n"
        return text
    except Exception as e:
        print(f"Error reading PDF {pdf_path}: {e}")
        return ""

def generate_optimized_listing(category_keywords_objs: list, pdf_path: str, product_type: str = "", product_size: str = "", box_size: str = "") -> dict:
    """
    Generates an optimized Etsy listing based on eRank keywords and rules from a PDF.
    Output is strictly in JSON format.
    """
    try:
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is missing. Cannot call Gemini API.")

        pdf_content = extract_text_from_pdf(pdf_path)
        
        if not pdf_content:
            print("Warning: PDF content is empty or could not be read.")
            
        system_instruction = (
            "Bu PDF dosyasındaki kurallar senin Etsy algoritma anayasan'dır. "
            "Verilen eRank kelimelerinden ÜRÜN TİPİ İLE SEMANTİK OLARAK EN UYUMLU OLANLARI SEÇEREK (alakasız kelimeleri eleyerek), "
            "SADECE bu PDF'teki kurallara uygun bir SEO başlığı, 13 ana tag, 10 yedek tag ve açıklama yaz."
        )
        
        # Enforce the new strict prompt rules
        strict_rules = (
            "CRITICAL RULES YOU MUST FOLLOW EXACTLY:\n"
            "1. LANGUAGE: The generated 'title', 'description', and 'tags' MUST BE 100% in English. Do NOT use any Turkish words.\n"
        )
        
        if product_type.strip().lower() in ["candle", "mum"]:
            strict_rules += "2. MATERIAL & SCENT: Since this is a Candle, DO NOT write any material information anywhere in the description. Furthermore, these candles are UNSCENTED. Do NOT use words like scent, fragrance, or aroma. You may write 'unscented'.\n"
        else:
            strict_rules += "2. MATERIAL: You may include material information if applicable.\n"
            
        dim_rules = []
        if product_size:
            dim_rules.append(f"Product Size: {product_size}")
        if box_size:
            dim_rules.append(f"Box Size: {box_size}")
            
        if dim_rules:
            strict_rules += f"3. DIMENSIONS: Use EXACTLY these dimensions: {', '.join(dim_rules)}. DO NOT invent or guess any other dimensions.\n"
        else:
            strict_rules += "3. DIMENSIONS: DO NOT invent or write any product or box dimensions since none were provided.\n"
            
        strict_rules += (
            "4. PACKAGING: The packaging options MUST be written EXACTLY as: 'White Box, Kraft Box, and Clear Bag'. Do not mention any box colors.\n"
            "5. CARE INSTRUCTIONS: DO NOT write any care instructions.\n"
            "6. SHIPPING: The shipping section MUST contain EXACTLY this text and nothing else: 'Ready to ship in 1-5 business days. Standard and express shipping options are available at checkout.'\n"
            "7. FOOTER: Every description MUST end with EXACTLY this text (do not invent your own sales pitch):\n\n"
            "❤Please visit our shop for other party favors, you will love them ❤:\n"
            "➢ https://www.etsy.com/shop/EynisaPartyFavors\n\n"
            "I'll always be adding new pieces to my shop, so be sure to heart my shop.\n"
            "If you have any questions , please write me :)\n"
            "Thank you :)\n"
            "8. DESCRIPTION STYLE: Use a luxurious, aesthetic, and elegant tone that will impress guests. You MUST include a 'Perfect for:' list, and naturally emphasize the selected concepts in it. Also, SYNERGIZE the SEO tags naturally within the description sentences, don't just list them.\n"
        )
        
        category_keywords = [obj["keyword"] for obj in category_keywords_objs] if category_keywords_objs else []
        
        prompt = (
            f"PDF KURALLARI (ANAYASA):\n{pdf_content}\n\n"
            f"ERANK KELİMELERİ (BUNLARDAN SADECE ANLAMLI OLANLARI SEÇ):\n{category_keywords}\n\n"
            f"{strict_rules}\n\n"
            "Lütfen aşağıdaki alanları içeren katı bir JSON formatı döndür:\n"
            "- 'title' (string)\n"
            "- 'tags' (array of exactly 13 strings)\n"
            "- 'backup_tags' (array of exactly 10 strings)\n"
            "- 'description' (string)"
        )
        
        # Initialize the model with the system instruction
        model = genai.GenerativeModel(
            model_name="gemini-2.5-flash",
            system_instruction=system_instruction,
            generation_config={"response_mime_type": "application/json"}
        )
        
        response = model.generate_content(prompt)
        
        # Gemini will return valid JSON string
        result = json.loads(response.text)
        
        # Post-processing: 20 Character Tag Filter & Mapping
        generated_tags = result.get("tags", [])
        generated_backup = result.get("backup_tags", [])
        
        if not isinstance(generated_tags, list): generated_tags = []
        if not isinstance(generated_backup, list): generated_backup = []
            
        # Create a pool of unused valid keywords from eRank (<= 20 chars)
        used_set = set([str(t).strip() for t in generated_tags + generated_backup])
        unused_keywords = [obj for obj in category_keywords_objs if obj["keyword"] not in used_set and len(obj["keyword"]) <= 20]
        
        def process_tags(target_list, required_len):
            valid_objs = []
            for tag in target_list:
                tag_str = str(tag).strip()
                tag_obj = next((o for o in category_keywords_objs if o["keyword"] == tag_str), {"keyword": tag_str, "searches": 0, "competition": 0})
                
                if len(tag_str) <= 20:
                    valid_objs.append(tag_obj)
                else:
                    if unused_keywords:
                        valid_objs.append(unused_keywords.pop(0))
                    else:
                        t = dict(tag_obj)
                        t["keyword"] = tag_str[:20].strip()
                        valid_objs.append(t)
                        
            while len(valid_objs) < required_len and unused_keywords:
                valid_objs.append(unused_keywords.pop(0))
                
            return valid_objs[:required_len]
            
        result["tags"] = process_tags(generated_tags, 13)
        result["backup_tags"] = process_tags(generated_backup, 10)
        
        return result
        
    except Exception as e:
        print(f"Error generating optimized listing: {e}")
        return {"error": str(e)}
