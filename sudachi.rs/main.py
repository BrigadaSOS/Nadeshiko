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
        for file in archive.namelist():
            if file.startswith('term'):
                with archive.open(file) as f:
                    data = json.loads(f.read().decode("utf-8"))
                    for entry in data:
                        key = entry[0]
                        if key in output_map:
                            output_map[key].append(entry)
                        else:
                            output_map[key] = [entry]
    return output_map

# Cargar JMDict durante el inicio del servidor
dictionary_map = load_dictionary(Path(SCRIPT_DIR, 'dictionaries', 'jmdict_english.zip'))

def look_up(word):
    if word in dictionary_map:
        return [{
            'headword': entry[0],
            'reading': entry[1],
            'tags': entry[2],
            'glossary_list': entry[5],
            'sequence': entry[6]
        } for entry in dictionary_map[word]]
    return None

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
