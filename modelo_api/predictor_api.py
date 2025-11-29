# - Limpia texto
# - Detecta columna de ID automáticamente
# - Convierte sí/no a 1/0
# - Aplica get_dummies()
# - Reindexa a las columnas de entrenamiento
# - Aplica scaler
# - Predice con el modelo entrenado
# Listo para producción

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
import pandas as pd
import numpy as np
import joblib
import unidecode
import os
import math

app = FastAPI(title="PRP Predictor API")

# -------------------------------------------
# Cargar artefactos generados en el notebook
# -------------------------------------------
BASE_DIR = os.path.dirname(__file__)
COLUMNS_PKL = os.path.join(BASE_DIR, "columnas_entrenamiento.pkl")
SCALER_PKL = os.path.join(BASE_DIR, "scaler_prp.pkl")
MODEL_PKL = os.path.join(BASE_DIR, "modelo_rotacion_prp.pkl")

if not os.path.exists(COLUMNS_PKL):
    raise RuntimeError("No se encontró columnas_entrenamiento.pkl")

if not os.path.exists(SCALER_PKL):
    raise RuntimeError("No se encontró scaler_prp.pkl")

if not os.path.exists(MODEL_PKL):
    raise RuntimeError("No se encontró modelo_rotacion_prp.pkl")

columnas = joblib.load(COLUMNS_PKL)
scaler = joblib.load(SCALER_PKL)
modelo = joblib.load(MODEL_PKL)

# Alias comunes que pueden indicar ID del empleado
ID_ALIASES = [
    "id","id_empleado","employee_id",
    "empleado_id","codigo","dni","doc"
]

# -------------------------------------------
# Funciones auxiliares de limpieza
# -------------------------------------------

def normalizar_columna(nombre):
    """Normaliza el nombre de columnas: minúsculas, sin tildes, underscores."""
    nombre = unidecode.unidecode(str(nombre).strip().lower())
    nombre = nombre.replace(" ", "_").replace("-", "_")
    return "".join(c for c in nombre if c.isalnum() or c == "_")


def detectar_id(df: pd.DataFrame) -> Optional[str]:
    """Detecta automáticamente la columna que contiene el ID del empleado."""
    columnas_norm = {normalizar_columna(c): c for c in df.columns}

    # Primero comparación directa con alias
    for alias in ID_ALIASES:
        if alias in columnas_norm:
            return columnas_norm[alias]

    # Luego heurística
    for norm, original in columnas_norm.items():
        if norm == "id" or norm.endswith("_id") or "emple" in norm or "codigo" in norm:
            return original

    return None

def sanitize_input_value(v):
    """Convierte los valores de entrada en algo seguro para Pandas."""
    try:
        # numpy scalar -> extract
        if hasattr(v, "item"):
            v = v.item()
        # bytes
        if isinstance(v, (bytes, bytearray)):
            v = v.decode("utf-8", errors="ignore")
        # strings vacíos o que representan NaN
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("", "nan", "none", "null", "inf", "-inf", "+inf"):
                return None
            return v
        # floats NaN/Inf
        if isinstance(v, float):
            if math.isnan(v) or math.isinf(v):
                return None
            return v
        return v
    except:
        return None


def sanitize_row_before_df(row: dict) -> dict:
    """Aplica sanitización campo por campo ANTES de construir el DataFrame."""
    out = {}
    for k, v in row.items():
        out[k] = sanitize_input_value(v)
    return out


def preprocesar_df(df_raw: pd.DataFrame):
    """
    Realiza la limpieza igual que en tu notebook:
    - Detectar ID
    - Limpieza de texto
    - Convertir valores a números
    - One Hot Encoding
    - Reindexar a columnas del entrenamiento
    """
    df = df_raw.copy()

    # Detectar columna de ID
    id_col = detectar_id(df)
    if id_col:
        employee_ids = df[id_col].astype(str).tolist()
        df = df.drop(columns=[id_col])
    else:
        employee_ids = [None] * len(df)

    # Normalizar nombres de columnas
    df.columns = [normalizar_columna(c) for c in df.columns]

    # Limpieza básica
    for c in df.columns:
        df[c] = df[c].astype(str)
        df[c] = df[c].str.replace(",", ".")
        df[c] = df[c].replace(
            {"sí": "1", "si": "1", "s": "1", "yes": "1",
             "no": "0", "n": "0", "true": "1", "false": "0"},
            regex=False
        )
        # Convertir a numérico cuando se pueda
        df[c] = pd.to_numeric(df[c], errors="ignore")

    # Convertir categóricas a Dummies (One Hot)
    df_ohe = pd.get_dummies(df, dummy_na=False)

    # Reindexar al orden del entrenamiento
    df_final = pd.DataFrame(0, index=df_ohe.index, columns=columnas)
    columnas_comunes = [c for c in df_ohe.columns if c in columnas]
    df_final.loc[:, columnas_comunes] = df_ohe[columnas_comunes]

    df_final = df_final.fillna(0).astype(float)

    return df_final, employee_ids

# ---------------------------------------------------------
# Modelo de entrada para FastAPI
# ---------------------------------------------------------

class Batch(BaseModel):
    rows: List[Dict[str, object]]

# ---------------------------------------------------------
# ENDPOINT PRINCIPAL /predict
# ---------------------------------------------------------

@app.post("/predict")
def predict(data: Batch):
    try:
        # sanitizar cada fila ANTES de crear el DataFrame
        safe_rows = [sanitize_row_before_df(r) for r in data.rows]

        df_raw = pd.DataFrame(safe_rows)

        if df_raw.empty:
            raise HTTPException(status_code=400, detail="No se recibieron filas.")

        # Preprocesamiento completo
        X_df, employee_ids = preprocesar_df(df_raw)

        # Escalado
        X_scaled = scaler.transform(X_df.values)

        # Predicción (con diagnóstico)
        pred = modelo.predict(X_scaled)

        # intentar obtener probabilidades; si falla, rellenar con ceros
        try:
            prob = modelo.predict_proba(X_scaled)[:, 1]
        except Exception:
            prob = np.zeros(len(pred), dtype=float)

        # ---------- DIAGNÓSTICO: detectar NaN / inf en prob ----------
        mask_nan = np.isnan(prob) | np.isinf(prob)
        if mask_nan.any():
            import logging
            logging.warning(f"DEBUG: NaN/inf en prob en índices: {np.where(mask_nan)[0].tolist()}")
            # intentar registrar las filas originales si están en scope (df_raw)
            try:
                problematic_rows = df_raw.iloc[np.where(mask_nan)[0]].to_dict(orient='records')
                logging.warning(f"DEBUG: filas originales problemáticas: {problematic_rows}")
            except Exception:
                logging.warning("DEBUG: no se pudo extraer filas originales para debug.")
# -----------------------------------------------------------

# ---------- DIAGNÓSTICO: revisar X_scaled por valores extremos ----------
        try:
            mins = np.nanmin(X_scaled, axis=0)
            maxs = np.nanmax(X_scaled, axis=0)
            bad_min_idx = np.where(np.isinf(mins) | (mins < -1e6))[0].tolist()
            bad_max_idx = np.where(np.isinf(maxs) | (maxs > 1e6))[0].tolist()
            if bad_min_idx or bad_max_idx:
                logging.warning(f"DEBUG: columnas X_scaled con valores extremos min_idx={bad_min_idx} max_idx={bad_max_idx}")
        except Exception:
            # no detener por diagnóstico
            pass
# -----------------------------------------------------------

# --- SANITIZAR VALORES PARA JSON (seguimos evitando NaN en la respuesta) ---
        prob = np.nan_to_num(prob, nan=0.0, posinf=1.0, neginf=0.0)
        pred = np.nan_to_num(pred, nan=0).astype(int)
# ----------------------------------------------------------------------------


        resultados = []
        for i in range(len(pred)):
            resultados.append({
                "index": i,
                "employee_id": employee_ids[i],
                "prediccion": int(pred[i]),
                "probabilidad": float(prob[i])
            })

        return {"results": resultados}

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error interno: {str(e)}")