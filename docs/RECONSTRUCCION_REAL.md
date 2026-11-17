# Reconstrucción real y atlas comparativo

La tercera vista, **Modelo completo · RM real**, usa como fuente principal las adquisiciones DICOM del estudio seleccionado. **No** transfiere geometrías de lesiones desde el atlas al paciente. No se copian hallazgos ni localizaciones del modelo educativo 3D Iker.

## Funciones implementadas
- Inventario de las series originales; clasificación de cerebro, médula/columna y difusión, excluyendo DTI/FA/ADC como volúmenes anatómicos combinables.
- Recomendación inicial de las series de mejor cobertura tridimensional.
- Vista 3D real con hasta cuatro volúmenes DICOM y sus coordenadas físicas LPS, colores y opacidades independientes.
- Filtro de cerebro, columna o todo el estudio, junto a marcadores físicos y máscaras NIfTI compatibles, cuando existan.
- Subvista opcional de **atlas educativo comparativo**, que usa mallas anatómicas genéricas y puntos esquemáticos solo cuando el informe menciona regiones. No hay registro automático del atlas al paciente y sus puntos no representan medidas, posición exacta ni contornos tumorales.
- Importación y extracción local del informe PDF, con OCR Tesseract español/inglés para escaneos de hasta doce páginas. El texto extraído puede contener errores graves de negación y requiere revisión.

## Riesgos y próximos avances de fidelidad
Un conjunto de volúmenes alineados en coordenadas DICOM **no equivale** a segmentar anatómicamente cerebro, cerebelo, tronco, nervios o tumor. Una misma referencia FrameOfReferenceUID tampoco descarta el movimiento entre adquisiciones. La adquisición de 360 cortes 3D Brain T2 es una fuente adecuada para intentar máscaras anatómicas, pero requiere extracción cerebral y segmentación revisadas. Los métodos posibles incluyen **SynthStrip pediátrico** (máscara de cerebro) y **SynthSeg** (estructuras), con control de calidad específico en pacientes pediátricos y con lesiones extensas; ninguno detecta automáticamente un tumor AT/RT con fidelidad garantizada.

Para lograr una superficie cerebral personalizada de alta fidelidad, ejecutar una segmentación cerebral revisada sobre el DICOM real, registrar otras secuencias si fuese necesario y generar una malla sobre una máscara etiquetada. Los tumores y la diseminación requieren máscaras propias verificadas por especialista. No dibujar lesiones automáticas basadas solo en texto.

## Atribuciones
Atlas genérico Brain Project (https://github.com/itayinbarr/brainproject) construido con aportes de Z-Anatomy / BodyParts3D, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Snapshot público en commit 2929e94f521a8ddceab26bc100a98dc06b0da060. Archivo genérico GLB verificado por SHA256 76a49ea4526a4880613aec7a02756bd7301b0b9d0680d7cae33e197b672c5453.
