# Segmentación desde cortes DICOM y reconstrucción 3D por estructuras

**Módulo experimental de referencia y edición manual; no es diagnóstico.**

## Uso paso a paso

1. Entra a RM Studio, elige el estudio y pulsa **Segmentación precisa desde cortes**.
2. El editor recomienda una secuencia anatómica tridimensional, idealmente 3D_Brain_T2_SAG SPAIR. Puedes cambiar a T1 con contraste (eeT1W_3D_TFE_SPAIR GD) o FLAIR cuando se vean mejor otras regiones.
3. Para médula y columna, usa las adquisiciones espinales B_FFE_SAG CD o DL del estudio. No apiles DTI, ADC o FA como cortes anatómicos.
4. Los tres planos corresponden a los ejes X, Y y Z del volumen DICOM. Están sincronizados: pulsar un plano mueve el cursor de los otros dos. Recorre cada uno con su deslizador.
5. Selecciona estructura, nombre y color; crea una máscara binaria vacía a resolución original DICOM. Una máscara distinta por estructura permite encender y apagar sus capas.
6. Edita sobre los cortes usando pincel, borrador y contorno poligonal. La selección por intensidad crece desde una semilla dentro de una vecindad limitada; es una ayuda gráfica, no detección automática de lesión.
7. Para interpolar, dibuja una máscara en dos cortes separados de un mismo eje y completa solamente los cortes intermedios vacíos. El suavizado es optativo, por corte, y conserva una revisión previa.
8. Usa **Crear copia editable** para modificar la máscara cerebral SynthStrip experimental o una importada; las originales permanecen intactas.
9. Si ya tienes segmentaciones validadas, importa NIfTI desde el editor. El backend rechaza geometrías incompatibles en orientación, espaciado u origen.
10. En **Reconstrucción 3D**, revisa superficies coloreadas generadas desde las máscaras; puedes rotar, hacer zoom y mostrar hasta ocho mallas simultáneas que compartan el marco espacial del estudio.

## Exportación y persistencia

- GLB: malla con color para Blender, Three.js o visualización 3D.
- OBJ: geometría para software de modelado.
- STL: geometría sin colores, útil para impresión y otras aplicaciones.
- NIfTI comprimido: máscara binaria a la resolución original DICOM y con sus coordenadas físicas.
- Cada edición crea una nueva revisión persistente en PostgreSQL, con un historial de hasta 12 instantáneas anteriores.
- Las mallas son vistas derivadas y pueden estar reducidas para rendimiento; el NIfTI original no se reduce.
- No se crea otro PostgreSQL ni se publican archivos DICOM en el repositorio GitHub.

## Qué puede y qué no puede hacer

Las vistas previas de los tres ejes reflejan la matriz de cada volumen DICOM; los ejes X/Y/Z no equivalen necesariamente a planos anatómicos canónicos. La precisión geométrica de las superficies es la de los vóxeles etiquetados, pero los contornos solo son correctos si la segmentación es correcta.

El informe PDF puede orientar dónde revisar, pero no aporta automáticamente coordenadas o bordes tumorales. El software no detecta automáticamente tumores, diseminación leptomeníngea, nervios ni otras lesiones. La selección por intensidad, la interpolación y SynthStrip son procedimientos experimentales con posibilidad de errores y requieren validación médica. No deben utilizarse para diagnóstico ni decisiones clínicas.

Las mallas de distintas series comparten coordenadas físicas del estudio cuando comparten FrameOfReferenceUID. Esto no prueba que no existiera movimiento del paciente; puede requerirse registro adicional.

## APIs privadas

- POST /api/studies/{study_id}/segmentation/masks
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/duplicate
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/paint
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/grow
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/interpolate
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/smooth
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/slice
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/mesh.glb
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/mesh.obj
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/mesh.stl
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/export.nii.gz
- GET /api/studies/{study_id}/segmentation/masks/{mask_id}/history
- POST /api/studies/{study_id}/segmentation/masks/{mask_id}/restore

Dependencias: FastAPI, PostgreSQL existente, SimpleITK, NumPy, Pillow, SciPy, scikit-image y Trimesh. Todas las operaciones se ejecutan localmente en el Y700.


## Ubicar puntos de tumores, focos y diseminación en el modelo 3D

Nueva sección: «Ubicar hallazgos en el modelo 3D».

1. Abre el estudio en «Segmentación precisa desde cortes». Selecciona una secuencia DICOM donde la estructura pueda revisarse.
2. Desplaza el cursor en cualquiera de los tres ejes sincronizados hasta un punto elegido manualmente.
3. Si quieres, enlaza una mención del informe; se muestra la página y el texto. No se ofrecen menciones negadas o descartadas. El OCR puede equivocarse.
4. Selecciona «Tumores / lesiones», «Meninges / diseminación» u otra categoría y escribe la etiqueta.
5. Pulsa «Mostrar este punto en 3D». Se almacena su ubicación física LPS, transformada desde el vóxel y validada dentro de la serie original.
6. «Localizar» vuelve a centrar el modelo 3D y los tres cortes sobre el punto. «Eliminar» quita la referencia sin afectar DICOM ni máscaras.
7. También se reutilizan estas anotaciones en el modo «Modelo completo · RM real».

**Advertencia:** un punto es una referencia elegida manualmente y no identifica ni demuestra un tumor o su tamaño, volumen o extensión. La forma real requiere delineación de una máscara y revisión especializada.

La API de marcadores permite un vínculo opcional con un hallazgo del informe solamente cuando la ubicación fue marcada manualmente en un corte. PostgreSQL guarda el origen manual, el estado sin verificar y el vínculo al fragmento textual; los datos permanecen privados en el Y700.
