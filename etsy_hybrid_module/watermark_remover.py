import cv2
import numpy as np
import os

def remove_ai_watermark(image_path: str, output_path: str) -> bool:
    """
    Removes a fixed watermark from the bottom-right corner of an image using OpenCV inpainting.
    """
    try:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found at path: {image_path}")

        # Read the image
        img = cv2.imread(image_path)
        if img is None:
            raise ValueError(f"Could not decode image at path: {image_path}")
            
        height, width = img.shape[:2]
        
        # Define watermark region (bottom-right corner)
        # Adjust these percentages based on the actual size of the AI watermark
        watermark_width = int(width * 0.15)  # Assume watermark takes up 15% of width
        watermark_height = int(height * 0.10) # Assume watermark takes up 10% of height
        
        start_x = width - watermark_width
        start_y = height - watermark_height
        
        # Create a mask for inpainting
        # The mask is single-channel, 8-bit image
        mask = np.zeros((height, width), dtype=np.uint8)
        
        # Fill the watermark area in the mask with 255 (white)
        margin = 5
        mask_start_x = max(0, start_x - margin)
        mask_start_y = max(0, start_y - margin)
        
        cv2.rectangle(mask, (mask_start_x, mask_start_y), (width, height), 255, -1)
        
        # Apply inpainting using the Telea algorithm
        # inpaintRadius is the radius of the neighborhood to consider
        result = cv2.inpaint(img, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
        
        # Ensure output directory exists
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        
        # Save the result
        success = cv2.imwrite(output_path, result)
        
        if success:
            print(f"Watermark successfully removed and saved to {output_path}")
            return True
        else:
            raise IOError(f"Failed to write image to {output_path}")
            
    except Exception as e:
        print(f"Error in remove_ai_watermark: {e}")
        return False
