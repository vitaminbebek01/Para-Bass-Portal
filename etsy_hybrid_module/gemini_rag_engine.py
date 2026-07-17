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

def generate_optimized_listing(category_keywords: list, pdf_path: str) -> dict:
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
            "Verilen eRank kelimelerini kullanarak, SADECE bu PDF'teki kurallara "
            "(özellikle 13 tag ve ilk 160 karakter kuralına) uygun bir SEO başlığı, "
            "13 tag ve açıklama yaz."
        )
        
        prompt = (
            f"PDF KURALLARI (ANAYASA):\n{pdf_content}\n\n"
            f"ERANK KELİMELERİ:\n{category_keywords}\n\n"
            "Lütfen aşağıdaki alanları içeren katı bir JSON formatı döndür:\n"
            "- 'title' (string)\n"
            "- 'tags' (array of 13 strings)\n"
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
        return json.loads(response.text)
        
    except Exception as e:
        print(f"Error generating optimized listing: {e}")
        return {"error": str(e)}
