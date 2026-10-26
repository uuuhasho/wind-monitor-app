import os
import zipfile
import shutil

def get_libreoffice_cmd():
    """Finds the LibreOffice executable across Linux and Windows systems."""
    for name in ["soffice.com", "soffice.exe", "soffice", "libreoffice"]:
        cmd = shutil.which(name)
        if cmd:
            return cmd
    if os.name == "nt":
        candidates = [
            r"C:\Program Files\LibreOffice\program\soffice.com",
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.com",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ]
        for path in candidates:
            if os.path.exists(path):
                return path
    return "libreoffice"


def convert_doc_to_docx(doc_path, docx_path):
    """
    Converts a binary .doc file to a .docx file using Word COM automation.
    If Word is not available (e.g., in non-Windows / GitHub Actions environments,
    or Windows systems without Microsoft Office), falls back to LibreOffice headless.
    """
    abs_doc = os.path.abspath(doc_path)
    abs_docx = os.path.abspath(docx_path)
    
    # If the docx already exists, we can skip conversion (serves as fallback/cache)
    if os.path.exists(abs_docx):
        print(f"Target .docx already exists: {abs_docx}. Skipping conversion.")
        return abs_docx
        
    print(f"Attempting Word COM automation to convert {doc_path} to {docx_path}...")
    try:
        import win32com.client
        # DispatchEx starts a fresh instance of Word
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        
        try:
            doc = word.Documents.Open(abs_doc)
            # FileFormat=16 is for wdFormatXMLDocument (.docx)
            doc.SaveAs2(abs_docx, FileFormat=16)
            doc.Close()
            print("Word COM conversion successful!")
        finally:
            word.Quit()
            
        return abs_docx
    except Exception as e:
        print(f"Word COM conversion failed: {e}. Trying LibreOffice headless fallback...")
        
        import subprocess
        try:
            outdir = os.path.dirname(abs_docx)
            lo_bin = get_libreoffice_cmd()
            cmd = [lo_bin, "--headless", "--convert-to", "docx", abs_doc, "--outdir", outdir]
            
            print(f"Executing command: {' '.join(cmd)}")
            subprocess.run(cmd, check=True)
            
            # LibreOffice produces a .docx file in outdir with the same base name
            expected_output = os.path.join(outdir, os.path.splitext(os.path.basename(abs_doc))[0] + ".docx")
            if os.path.exists(expected_output) and os.path.abspath(expected_output) != abs_docx:
                shutil.move(expected_output, abs_docx)
                
            if os.path.exists(abs_docx):
                print("LibreOffice headless conversion successful!")
                return abs_docx
        except Exception as le:
            print(f"LibreOffice fallback conversion failed: {le}")
            
        if os.path.exists(abs_docx):
            return abs_docx
        raise RuntimeError("Failed to convert .doc to .docx. Word COM is required on Windows, and LibreOffice is required on Linux.")


def extract_image_from_docx(docx_path, output_img_path):
    """
    Extracts the first image from docx file (which represents the wind forecast chart).
    """
    print(f"Extracting image from {docx_path} to {output_img_path}...")
    if not os.path.exists(docx_path):
        raise FileNotFoundError(f"File not found: {docx_path}")
        
    try:
        with zipfile.ZipFile(docx_path, 'r') as archive:
            # Document images are stored under word/media/
            image_files = [f for f in archive.namelist() if f.startswith('word/media/')]
            if not image_files:
                raise ValueError("No images found in the DOCX file.")
            
            # Sort to get image1.png, image2.png etc.
            image_files.sort()
            target_img = image_files[0]
            print(f"Found image file in docx: {target_img}")
            
            # Save the extracted image to output_img_path
            with open(output_img_path, 'wb') as out_f:
                out_f.write(archive.read(target_img))
            print(f"Image extracted successfully: {output_img_path}")
            return output_img_path
            
    except Exception as e:
        print(f"Error extracting image: {e}")
        raise e
