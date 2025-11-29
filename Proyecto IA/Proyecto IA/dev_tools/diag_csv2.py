# diag_csv2.py
import pandas as pd, numpy as np, math, sys, os

csv_path = r"E:\Proyecto IA\uploads\1764117646103_Base_Empleados.csv"  # AJUSTA

df = pd.read_csv(csv_path, dtype=object, low_memory=False)
print("shape:", df.shape)

bad_rows = []
for idx, row in df.iterrows():
    for col, v in row.items():
        s = str(v).strip()
        if s.lower() in ("nan","inf","+inf","-inf","infinite","infinito"):
            bad_rows.append((idx, col, v))
        else:
            # intentar convertir a float para detectar inf/nan numéricos
            try:
                fv = float(str(v).replace(',', '.'))
                if math.isnan(fv) or math.isinf(fv):
                    bad_rows.append((idx, col, v))
            except:
                pass

print("Encontrados:", len(bad_rows), "elementos problemáticos")
for i, (r,c,v) in enumerate(bad_rows[:30]):
    print(i, "fila", r, "col", c, "valor:", repr(v))
