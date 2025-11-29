# -*- coding: utf-8 -*-
import joblib

c = joblib.load("columnas_entrenamiento.pkl")
print("Tipo:", type(c))
print("Len:", len(c))
print("Primeras 10 columnas:", c[:10])
