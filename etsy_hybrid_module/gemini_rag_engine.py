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
            "Sen dünya çapında en iyi Etsy Algoritma Uzmanı (SEO Master) yapay zekasın. Görevin, sana verilen konseptleri, "
            "eRank anahtar kelimelerini ve ürün özelliklerini kullanarak, Etsy'nin en çok satan ürünleri arasına girecek, "
            "Premium/Luxury hissiyatı veren %100 İngilizce bir SEO başlığı, tag listesi ve ürün açıklaması oluşturmaktır."
        )
        
        # Enforce the new strict prompt rules
        strict_rules = (
            "CRITICAL RULES YOU MUST FOLLOW EXACTLY (DO NOT DEVIATE):\n"
            "1. LANGUAGE: Every generated word (Title, Tags, Description) MUST BE 100% in English. Absolutely no Turkish.\n"
            "2. ORGANIC SEO WIRING: You MUST organically weave the selected concepts and EXACTLY the 13 chosen long-tail tags into the Title and the FIRST PARAGRAPHS of the Description. Do not just list them; use them in natural, highly engaging, premium-sounding sentences.\n"
        )
        
        if product_type.strip().lower() in ["candle", "mum"]:
            strict_rules += "3. KOKUSUZ MUM KURALI (CANDLE): The product is a Candle. ALL CANDLES ARE UNSCENTED. DO NOT use the words 'scent', 'fragrance', or 'aroma'. DO NOT mention any materials (like soy wax, beeswax). You MUST emphasize that it is unscented and perfect for guests sensitive to smells.\n"
        else:
            strict_rules += "3. MATERIAL: You may naturally include material information if it enhances the premium feel.\n"
            
        dim_rules = []
        if product_size:
            dim_rules.append(f"Product Size: {product_size}")
        if box_size:
            dim_rules.append(f"Box Size: {box_size}")
            
        if dim_rules:
            strict_rules += f"4. DIMENSIONS: Use EXACTLY these dimensions: {', '.join(dim_rules)}.\n"
        else:
            strict_rules += "4. DIMENSIONS: DO NOT invent any dimensions.\n"
            
        strict_rules += (
            "5. PACKAGING (STRICT): The packaging options MUST be written EXACTLY as: 'White Box, Kraft Box, Clear Bag'. DO NOT offer or mention any other packaging or colors.\n"
            "6. CARE INSTRUCTIONS: DO NOT write any care instructions.\n"
            "7. SHIPPING: The shipping section MUST contain EXACTLY this text, word for word:\n"
            "'Ready to ship in 1-5 business days. Standard and express shipping options are available at checkout.'\n"
            "8. FIXED SIGNATURE: Every description MUST end with EXACTLY this signature block:\n\n"
            "❤Please visit our shop for other party favors, you will love them ❤:\n"
            "➢ https://www.etsy.com/shop/EynisaPartyFavors\n\n"
            "I'll always be adding new pieces to my shop, so be sure to heart my shop.\n"
            "If you have any questions , please write me :)\n"
            "Thank you :)\n\n"
            "9. PREMIUM TONE: The description MUST feel highly aesthetic, luxurious, and elegant, wowing the buyer at first glance. Include a 'Perfect for:' bulleted list to highlight the concepts."
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
