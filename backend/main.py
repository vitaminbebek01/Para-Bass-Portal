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

    # Clean up excessive newlines and split into lines
    lines = text.split('\n')
    
    # Process line by line to accurately match tracking numbers and their row totals
    for line in lines:
        for track in tracking_list:
            safe_track = str(track).strip()
            if not safe_track:
                continue
            
            # Check if this tracking number is in the line (as a distinct word/number)
            if re.search(r'\b' + re.escape(safe_track) + r'\b', line):
                # Find all monetary values (e.g. 12.34 or 12,34) on the same line
                prices = re.findall(r'\b\d+[,.]\d{2}\b', line)
                if prices:
                    # Take the last monetary value on the line (usually the total for that row)
                    val_str = prices[-1].replace(',', '.')
                    val_float = float(val_str)
                    
                    if safe_track in results:
                        results[safe_track] += val_float
                    else:
                        results[safe_track] = val_float
                break # Found the track for this line, go to next line

    return {"status": "success", "data": results, "extracted_text_preview": text[:500]}
