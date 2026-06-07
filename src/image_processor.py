import cv2
import numpy as np
import os

def remove_horizontal_red_line(input_path, output_path):
    """
    Loads an image from input_path, removes the horizontal red dotted line,
    and saves the cleaned image to output_path.
    """
    print(f"Processing image {input_path} to remove horizontal red line...")
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")
        
    img = cv2.imread(input_path)
    if img is None:
        raise ValueError(f"Failed to read image with OpenCV: {input_path}")
        
    h, w, c = img.shape
    
    # Convert image to HSV color space
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    
    # Red wrap-around in HSV space
    lower_red1 = np.array([0, 50, 50])
    upper_red1 = np.array([10, 255, 255])
    lower_red2 = np.array([170, 50, 50])
    upper_red2 = np.array([180, 255, 255])
    
    mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
    mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
    red_mask = mask1 | mask2
    
    # Analyze red pixel distribution row by row to find the horizontal dotted line
    rows, cols = np.where(red_mask > 0)
    if len(rows) == 0:
        print("No red pixels found in image. Saving original image as processed.")
        cv2.imwrite(output_path, img)
        return output_path
        
    row_spans = {}
    for r, c_idx in zip(rows, cols):
        if r not in row_spans:
            row_spans[r] = []
        row_spans[r].append(c_idx)
        
    # Thresholds: span > 80% of width, pixel count in row > 100
    dotted_rows = []
    for r, cs in row_spans.items():
        span = max(cs) - min(cs)
        if span > 0.8 * w and len(cs) > 100:
            dotted_rows.append((r, min(cs), max(cs)))
            
    print(f"Detected dotted line at rows (min_col, max_col): {dotted_rows}")
    
    processed_img = img.copy()
    # Paint white in the detected rows within the horizontal bounds of the dotted line
    for r, min_c, max_c in dotted_rows:
        # +/- 2 row window to erase antialiased pixels of the dotted line
        # min_c-1 to max_c+2 to cover the edge dots fully
        r_start = max(0, r - 2)
        r_end = min(h, r + 3)
        c_start = max(0, min_c - 1)
        c_end = min(w, max_c + 2)
        
        processed_img[r_start:r_end, c_start:c_end] = [255, 255, 255]
        
    # Write processed image
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    cv2.imwrite(output_path, processed_img)
    print(f"Processed image saved: {output_path}")
    return output_path
