# RM Studio — Modelos 3D de Resonancias Magnéticas

Aplicación web local para importar archivos DICOM de resonancia magnética desde un CD, adjuntar informes radiológicos PDF y visualizar cortes y volúmenes 3D.

**IMPORTANTE: herramienta exploratoria. No está validada para diagnóstico médico, detección de lesiones o decisiones de tratamiento.** El modelo 3D representa intensidades de imagen, no tumores segmentados. Algunas secuencias pueden no ser compatibles y la previsualización reduce a 8 bits las intensidades y puede disminuir su resolución espacial. Los DICOM originales se mantienen intactos en el almacenamiento local.

## Qué funciona en esta primera versión

- Subir un ZIP que contenga los archivos del CD, incluidas subcarpetas, o varios archivos DICOM individuales.
- Adjuntar un informe médico PDF al estudio y descargarlo desde la aplicación.
- Catalogar series de resonancia MR y elegir una secuencia.
- Reconstruir el volumen de intensidades según el orden geométrico de los cortes mediante SimpleITK/GDCM.
- Visualizar el volumen en 3D con VTK.js (rotación y zoom).
- Explorar cortes de los tres ejes, con espaciado y dimensiones espaciales.
- Mantener los DICOM originales sin cambios y eliminar estudios desde la interfaz.
- Limitar carga/descompresión ZIP y bloquear rutas peligrosas.
- Ejecutar tests con DICOM sintéticos (sin imágenes clínicas reales).

**Todavía no incluye** segmentación de tumores, agentes validadores, interpretación automática del informe, detección de patologías, medidas de lesiones, OHIF, Orthanc, MONAI, comparación de fechas ni exportación de mallas GLB. Estos componentes se incorporarán por etapas con revisión médica.

## Instalación en Ubuntu o Lenovo (Docker)

Requisitos: Docker Engine + Docker Compose, almacenamiento disponible para las resonancias y navegador con WebGL.

    git clone https://github.com/AlexisTorrresA/3d_modelos_rm.git
    cd 3d_modelos_rm
    docker compose up -d --build

Abrir en el **mismo equipo que ejecuta Docker**:

- Web: http://localhost:5173
- API y documentación: http://localhost:8000/api/docs

Diagnóstico:

    docker compose ps
    docker compose logs -f api
    docker compose logs -f web

Detener sin borrar estudios:

    docker compose down

Los estudios quedan en la carpeta local ./data/studies. Esta carpeta está excluida de Git.

## Uso desde otro ordenador, por SSH/Tailscale

Por defecto solo se escuchan conexiones en 127.0.0.1 por seguridad. Si ejecutas la aplicación en el Y700 y quieres verla en el Lenovo, desde el Lenovo establece un túnel SSH usando la IP privada del Y700:

    ssh -L 5173:127.0.0.1:5173 usuario@IP_PRIVADA_Y700

Después abre http://localhost:5173 en el Lenovo. Si usas Tailscale, puedes ocupar la IP privada de Tailscale para SSH. No abras esta versión directamente a Internet ni por Cloudflare Tunnel: carece de autenticación y controles de acceso multiusuario.

## Ejecución local sin Docker

Terminal backend (Python 3.12):

    cd backend
    python -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    DATA_DIR=../data uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

Terminal frontend (Node.js 22+):

    cd frontend
    npm install
    npm run dev

Luego abre http://localhost:5173. Para pruebas del backend:

    cd backend
    python -m pytest -q

GitHub Actions ejecuta pruebas del backend y compila el frontend.

## Uso

1. Copia el contenido de tu CD en el equipo. No compartas ni subas datos de pacientes al repositorio.
2. Comprime en un ZIP la carpeta DICOM completa (incluyendo sus subcarpetas), o elige los archivos DICOM individuales.
3. En la web, selecciona el ZIP o DICOM en la primera casilla y el PDF del informe en la segunda.
4. Pulsa **Cargar estudio**. El sistema identifica las series de modalidad MR.
5. Selecciona una serie, gira o amplía el 3D y navega por los cortes con las barras.
6. Si una serie no permite reconstrucción geométrica confiable, el sistema devuelve un error en vez de inventar datos.

Los cortes se muestran según los ejes del volumen y no deben interpretarse automáticamente como vistas clínicas canónicas. La representación 3D de intensidades puede ocultar zonas pequeñas o sutiles y **no reemplaza** una segmentación revisada por especialistas.

## Límites y privacidad

- Carga máxima predeterminada: 1 GiB; ZIP expandido: 3 GiB; hasta 10.000 archivos. Configuración en compose.yaml o variables MAX_UPLOAD_MB / MAX_EXPANDED_MB.
- Informe PDF: hasta 25 MiB.
- No se publica información médica en GitHub y no se envían imágenes a un proveedor de IA externo.
- El código se ofrece en un repositorio público, pero **los estudios clínicos deben permanecer privados**.
- Esta versión no tiene autenticación: cualquier persona con acceso a sus puertos podría leer/borrar estudios.
- Para producción se requiere autenticación, cifrado, auditoría, controles de acceso, aislamiento y evaluación de seguridad de archivos médicos.

## Arquitectura v0.1

- React + Vite + VTK.js: interfaz y render volumétrico.
- Python FastAPI: importación ZIP/DICOM, informe PDF, series y endpoints de imágenes.
- pydicom + SimpleITK/GDCM + NumPy + Pillow: lectura, ordenamiento y creación de previsualizaciones 3D.
- Archivos locales privados en ./data (sin base de datos ni PACS en esta versión).

## Etapas siguientes

1. Visor DICOM con OHIF/Cornerstone3D y manejo robusto de distintas secuencias MR.
2. Segmentación editable de zonas problemáticas mediante MONAI/nnU-Net y 3D Slicer, siempre con validación humana.
3. Máscaras NIfTI/DICOM SEG, exportación 3D GLB y comparación temporal.
4. Motor de validación geométrica, control de versiones y uso seguro multiusuario.
