from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import pdfplumber
import re
import json

app = FastAPI()

# Enable CORS so frontend can communicate with backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/upload-pdf")
async def process_pdf(file: UploadFile = File(...), trackings: str = Form(...)):
    """
    Reads a PDF file and searches for tracking numbers and their corresponding USD values.
    """
    try:
        tracking_list = json.loads(trackings)
    except Exception:
        tracking_list = []

    # Read PDF content
    results = {}
    content = await file.read()
    
    # Save temporarily to parse with pdfplumber
    temp_path = f"temp_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(content)

    text = ""
    try:
        with pdfplumber.open(temp_path) as pdf:
            for page in pdf.pages:
                # layout=True keeps the visual spacing, helping to keep price on the same line or block
                page_text = page.extract_text(layout=True)
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        import os
        if os.path.exists(temp_path):
            os.remove(temp_path)
        return {"error": str(e)}
        
    import os
    if os.path.exists(temp_path):
        os.remove(temp_path)

    # Clean up excessive newlines
    text = re.sub(r'\n+', '\n', text)
    
    # Now, find tracking numbers and the nearby USD amount
    for track in tracking_list:
        safe_track = re.escape(track)
        # Look for the tracking number, then some characters, then a price in USD
        # Example pattern: 123456789 ... 12.34 USD
        # We allow up to 200 characters between them, taking the first match
        pattern = safe_track + r'[\s\S]{1,200}?(\d+[,.]\d{2})\s*USD'
        matches = re.finditer(pattern, text, re.IGNORECASE)
        
        total = 0.0
        for match in matches:
            val_str = match.group(1).replace(',', '.')
            total += float(val_str)
            
        if total > 0:
            results[track] = total

    return {"status": "success", "data": results, "extracted_text_preview": text[:500]}
