# Informe radiológico y capas anatómicas

La versión del Y700 ahora admite un flujo adicional para los informes ya asociados a un estudio:

1. En Modelo integral, abrir Informe radiológico y hallazgos para revisar.
2. Si el estudio no tiene informe, adjuntar un PDF (sin volver a cargar los DICOM).
3. Usar Analizar informe y sugerir capas. El backend extrae texto localmente con pypdf, registra página y fragmento, y clasifica menciones de cerebro, lesiones, médula, meninges, nervios, cerebelo, tronco y ventrículos.
4. Revisar cada cita: dejar pendiente, marcar como revisada o descartar. Asociar una máscara NIfTI del mismo tipo cuando exista.
5. En el panel Capas por estructura anatómica, escoger colores y activar u ocultar máscaras y marcadores. Las menciones de informe aparecen separadas, como texto sin geometría tridimensional.

## Seguridad, precisión y limitaciones

Los hallazgos extraídos son coincidencias textuales y no diagnósticos. Las negaciones e incertidumbres se detectan por reglas y requieren revisión. No se inventan coordenadas ni contornos del tumor. Las máscaras importadas y alineadas sí tienen geometría real; los marcadores son esferas manuales orientativas. DTI y FA no equivalen a tractografía de nervios.

El PDF permanece en la base PostgreSQL del Y700; no hay llamadas a modelos externos ni publicación de material médico en el GitHub público. El PDF escaneado sin capa de texto muestra aviso de OCR pendiente. Reanalizar reinicia las revisiones; reemplazar el PDF invalida el análisis anterior. El login protege los endpoints.

Las funcionalidades del visor no sustituyen lectura radiológica, segmentación validada ni dictamen médico.

## PDF escaneado: OCR local
Si el informe no contiene texto seleccionable, el backend utiliza Tesseract en español e inglés y Poppler, de forma local y limitada (hasta 12 páginas, sin tráfico externo). **La transcripción puede contener errores**, incluida la palabra «no» en frases negativas. Cada mención continúa pendiente de revisión humana y no coloca lesiones automáticamente en coordenadas DICOM.
