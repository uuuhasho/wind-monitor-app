import json
import os
from PIL import Image
from pydantic import BaseModel, Field
from typing import List
from google import genai
from google.genai import types
from src.config import load_config

# Schema for Gemini Structured Output
class WindDataPoint(BaseModel):
    date_day: int = Field(description="Day of the month, e.g., 29, 30, 31, 1, 2, 3, 4, 5, 6")
    hour: int = Field(description="Hour of the day in UTC (Z), e.g., 0, 6, 12, 18")
    wind_speed_kt: float = Field(description="Wind speed value in KT read from the Y-axis (ranging from 0 to 50)")

class ForecastData(BaseModel):
    initial_date: str = Field(description="Initial date from the title, e.g., '12Z29MAY'")
    points: List[WindDataPoint] = Field(description="List of all forecast data points in chronological order from the red curve")

def parse_chart_with_gemini(image_path):
    """
    Sends the processed image to Gemini Vision API and returns the extracted wind forecast data structure.
    """
    print(f"Calling Gemini API to analyze image {image_path}...")
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Processed image not found: {image_path}")
        
    config = load_config()
    api_key = config.get("API_Keys", {}).get("GeminiApiKey")
    if not api_key:
        raise ValueError("Gemini API Key missing in config.json")
        
    # Open image
    img = Image.open(image_path)
    
    # Initialize client
    client = genai.Client(api_key=api_key)
    
    prompt = """
You are an expert meteorological data analyst.
Analyze the provided wind speed forecast line chart (SFC 10 m Windspeed).
The original chart had a horizontal red dotted line, which has been erased to leave only the red forecast curve with 'x' markers.
Please read and extract all the 'x' marker data points from the red curve.
1. The title is in the top right, e.g. "12Z29MAY initial fileld" which gives the initial month (MAY / JUN) and year.
2. The X-axis represents Date/Time(Z) in UTC. The first label is Day '29' Hour '12'. The next is Day '29' Hour '18', followed by Day '30' Hour '00', '06', '12', '18', up to Day '06' Hour '12'. Notice that the month transitions from May (29, 30, 31) to June (01, 02, 03, 04, 05, 06).
3. The Y-axis represents Windspeed in KT, ranging from 0 to 50 with ticks every 5 units.
4. Extract the exact value for each 'x' data point corresponding to each Date/Time tick on the X-axis.

Output the results strictly conforming to the JSON schema.
"""
    
    # Call Gemini 2.5 Flash
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=[img, prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ForecastData,
            temperature=0.1
        )
    )
    
    # Parse and validate JSON
    result_data = json.loads(response.text)
    print("Gemini API visual parsing completed successfully!")
    return result_data
