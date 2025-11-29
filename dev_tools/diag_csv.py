# diag_csv.py
import pandas as pd
import numpy as np
import os, sys

csv_path = r"E:\Proyecto IA\uploads\1764051201155_Empleadosnuevos.csv"  # <-- ajusta si tu fichero difiere

if not os.path.exists(csv_path):
    print("No encontrado:", csv_path)
    sys.exit(1)

df = pd.read_csv(csv_path, dtype=object, low_memory=False)
print("shape:", df.shape)

# buscar celdas con texto 'nan' 'inf' o vacías
for c in df.columns:
    s = df[c].astype(str).str.strip()
    n_nan_text = s.str.lower().isin(["nan"]).sum()
    n_inf_text = s.str.lower().isin(["inf","+inf","-inf"]).sum()
    n_empty = (s == "").sum()
    if n_nan_text or n_inf_text or n_empty:
        print(f"Columna '{c}': vacías={n_empty} texto_nan={n_nan_text} texto_inf={n_inf_text}")

# intentar coercer a numérico y ver filas con NaN resultante
df_num = df.copy()
for c in df_num.columns:
    df_num[c] = pd.to_numeric(df_num[c].astype(str).str.replace(',','.'), errors='coerce')
rows_with_nan = df_num.isna().any(axis=1).sum()
print("Filas con ANY NaN al forzar numeric:", rows_with_nan)
if rows_with_nan:
    idxs = df_num[df_num.isna().any(axis=1)].index[:10].tolist()
    print("Ejemplos de filas problemáticas (primeras 10):")
    print(df.loc[idxs].to_string(index=False))
