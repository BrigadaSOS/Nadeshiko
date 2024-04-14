from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sudachipy import tokenizer, dictionary
import zipfile
import json
from pathlib import Path

# Configuración inicial de FastAPI
app = FastAPI()

# Modelo Pydantic para las solicitudes de análisis
class AnalyzeRequest(BaseModel):
    mode: str
    text: str

# Mapeo de los modos de tokenización de Sudachi
MODE_MAP = {
    "A": tokenizer.Tokenizer.SplitMode.A,
    "B": tokenizer.Tokenizer.SplitMode.B,
    "C": tokenizer.Tokenizer.SplitMode.C,
}

# Cargar JMDict
SCRIPT_DIR = Path(__file__).parent
dictionary_map = {}

def load_dictionary(dictionary_path):
    output_map = {}
    with zipfile.ZipFile(dictionary_path, 'r') as archive:
        files = [file for file in archive.namelist() if file.startswith('term')]
        total_files = len(files)
        print("Iniciando la carga del diccionario...")
        for i, file in enumerate(files, 1):
            with archive.open(file) as f:
                data = json.loads(f.read().decode("utf-8"))
                for entry in data:
                    key = entry[0]
                    if key in output_map:
                        output_map[key].append(entry)
                    else:
                        output_map[key] = [entry]
            print(f"Progreso: {i / total_files * 100:.2f}% ({i}/{total_files})")
    print("Carga del diccionario completada.")
    return output_map

# Cargar JMDict durante el inicio del servidor
dictionary_map = load_dictionary(Path(SCRIPT_DIR, 'dictionaries', 'jitendex_english.zip'))

def look_up(word):
    results = []  
    # Si se encuentra la palabra en el diccionario
    if word in dictionary_map:
        # Por cada entrada de una palabra guarda los datos relevantes
        for entry in dictionary_map[word]:
            headword = entry[0]
            reading = entry[1]
            tags = entry[2]
            sequence = entry[6]
       
            jitendex = {
                "code": [],
                "definition": [],
                "examples": []
            }
      
            # Se accede al glossary_list
            for glossary_item in entry[5]:

                if(glossary_item["type"] == "structured-content"):
                    if "content" in glossary_item:
                        content = glossary_item["content"]
                        if "tag" in content:
                            # HTML list case (ul)
                            if(content["tag"] == 'ul'):
                                content_ul = content["content"]
                                for ul_item in content_ul:
                                    
                                    if "tag" in ul_item and ul_item["tag"] == "li":
                                        code_list = []
                                        if isinstance(ul_item["content"], list):
                                            for content_item in ul_item["content"]:
                                                if isinstance(content_item, dict):
                                                    tag = content_item.get("tag", None)
                                                    # Tratamiento etiquetas
                                                    if tag == "span":
                                                        if "data" in content_item:
                                                            data = content_item["data"]
                                                            code = data.get("code", None)
                                                            print(f"Code: {code}")
                                                            
                                                            # Codigos descriptivos de la palabra
                                                            if(code == "n" or code == "uk"):
                                                                content_span = content_item.get("content", "No content found")
                                                                #print(content_span)
                                                                code_list.append(code)

                                                    # Tratamiento definiciones y ejemplos
                                                    elif tag == "ol":
                                                        content_ol = content_item["content"]
                                                        if isinstance(content_ol, dict) and content_ol.get("tag") == "li":
                                                            ol_li_content = content_ol.get("content", [])
                                                            if isinstance(ol_li_content, list):
                                                                for ol_li_content_item in ol_li_content:
                                                                    if isinstance(ol_li_content_item, dict):
                                                                        if ol_li_content_item.get("tag") == "ul":
                                                                            ul_content = ol_li_content_item.get("content", [])
                                                                            for ul_content_item in ul_content:
                                                                                if isinstance(ul_content_item, dict) and ul_content_item.get("tag") == "li":
                                                                                    print(ul_content_item.get("content", "No li content found"))
                                                            
                                                            # print(content_ol)
                                                elif isinstance(content_item, str):
                                                    #print(content_item)
                                                    pass
                                    jitendex["code"].append(code_list)
                results.append(jitendex)
        
    return results

# Endpoint para análisis y búsqueda en el diccionario
@app.post("/dictionary/analyze/")
async def analyze_text(request: AnalyzeRequest):
    tokenizer_obj = dictionary.Dictionary().create()
    mode = MODE_MAP.get(request.mode.upper())

    if not mode:
        raise HTTPException(status_code=400, detail=f"Invalid mode '{request.mode}'. Valid modes are A, B, C.")

    morphemes = tokenizer_obj.tokenize(request.text, mode)
    
    tokens_info = []
    for m in morphemes:
        jmdict_entries = look_up(m.dictionary_form())
        token_data = {
            "surface": m.surface(),
            "dictionary_form": m.dictionary_form(),
            "reading_form": m.reading_form(),
            "part_of_speech": m.part_of_speech(),
            "normalized_form": m.normalized_form(),
            "jmdict_entries": jmdict_entries or "No entry found"
        }
        tokens_info.append(token_data)

    return {"tokens": tokens_info}
