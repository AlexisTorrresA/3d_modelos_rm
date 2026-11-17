# RM Studio 3D — Despliegue gestionado Y700

Sigue el estándar de [y700-app-starter](https://github.com/AlexisTorrresA/y700-app-starter).

| Componente | Configuración |
|---|---|
| Docker / GHCR | ghcr.io/alexistorrresa/3d-modelos-rm:main |
| Manifiesto | y700.deploy.yml |
| Dominio planeado | https://rm3d.alexistorreslabs.com |
| Puerto interno | 8000 |
| Contenedor | y700-rm3d |
| Red de proxy | y700-public |
| Red PostgreSQL | y700-data |
| Base dedicada | rm_studio_3d, en postgres-main |
| Usuario contenedor | 10001:10001 |
| Salud | GET /health |

No se instala otro PostgreSQL ni se abren puertos del host. El manager crea base de datos y usuario, y entrega DATABASE_URL a la aplicación.

## Secretos requeridos antes del despliegue

- RM3D_ADMIN_PASSWORD: contraseña de acceso (mínimo 14 caracteres).
- RM3D_SESSION_KEY: clave aleatoria de firma de sesión (mínimo 32 caracteres).

Debes configurarlos directamente en el servidor Y700, sin pegar valores en GitHub ni en el chat:

    sudo y700-secret set RM3D_ADMIN_PASSWORD
    sudo y700-secret set RM3D_SESSION_KEY

Genera una clave aleatoria segura para RM3D_SESSION_KEY. Hasta que existan, el manager puede indicar waiting_secret y no publicar la aplicación.

## Almacenamiento de originales

El manager actual no ofrece un volumen persistente por aplicación. Para no perder DICOM al recrear Docker, los archivos originales e informes se guardan en fragmentos BYTEA en la base PostgreSQL rm_studio_3d, con SHA256 verificado al rehidratarlos. Los metadatos van en JSONB; las previsualizaciones son caché regenerable.

**Advertencia de capacidad:** archivos grandes harán crecer PostgreSQL y los respaldos. Para uso intensivo, migrar los originales a disco persistente o almacenamiento de objetos privado y mantener solo metadatos en PostgreSQL. No borrar ni sobrescribir respaldos antes de validar una restauración de prueba.

La subida web usa bloques de 16 MiB, inferiores al límite típico por solicitud de Cloudflare.

## Despliegue

1. GitHub Actions prueba y publica una imagen linux/amd64 por cada push a main.
2. El Y700 Deployment Manager detecta el manifiesto y la imagen.
3. El manager crea la BD, conecta redes, inicia el contenedor y configura la ruta Caddy.
4. La web abre el login y protege los endpoints de datos médicos.

Ver estado desde el Y700:

    cat /server/apps-managed/rm3d/status.json
    docker ps --filter name=y700-rm3d
    docker logs --tail=100 y700-rm3d

No subir CD, PDF o datos privados al repositorio. Este proyecto es exploratorio, no diagnóstico.

## Modelo integral y marcadores

- **Por secuencia:** el volumen de una adquisición concreta, con color de visualización y opacidad.
- **Modelo integral:** una secuencia como base más hasta tres secuencias complementarias, mostradas en una misma escena VTK usando la geometría DICOM. No se concatenan los píxeles, no se fusionan todos los contrastes en un mapa diagnóstico y no se presupone que todas las series sean anatómicas.
- Verificación de StudyInstanceUID, FrameOfReferenceUID cuando está disponible, y solapamiento aproximado en coordenadas físicas. Aun así, los movimientos del paciente y los cambios de postura pueden exigir registro rígido o deformable antes de validar concordancia.
- **Marcadores manuales:** se crean pulsando en los cortes axial/coronal/sagital y se guardan en PostgreSQL. Se muestran como esferas de radio orientativo en milímetros, **no como segmentaciones ni volúmenes reales de tumores**. Su categoría, texto y color los elige el usuario.
- Series de difusión, FA y ADC pueden contener adquisiciones repetidas sobre la misma posición. El lector evita apilar esas posiciones como si fueran nuevos cortes de un volumen 3D.
- Para segmentación anatómica real y contornos de lesión se requerirá una etapa posterior de máscaras (p. ej. nnU-Net/MONAI o edición manual por vóxeles) con revisión del especialista. No interpretar la asignación de colores como prueba de un diagnóstico.


## Máscaras de segmentación NIfTI para colorear estructuras completas

La aplicación acepta cargar una **máscara binaria .nii o .nii.gz** asociada a la serie seleccionada. Puede contener un tumor delimitado por personal clínico, cerebro, ventrículos u otra estructura, siempre que se haya generado y validado por separado. El usuario asigna nombre y color. La máscara conserva su forma anatómica, a diferencia de los marcadores esféricos de referencia.

Para no mostrar tejidos incorrectos, exige coincidencia de dimensiones y geometría física (origen, spacing, dirección) con la serie DICOM asociada. Las máscaras con referencias incompatibles se rechazan, sin realizar transformaciones silenciosas. Las máscaras se guardan en PostgreSQL con su archivo NIfTI original y vista previa comprimida; permanecen tras recrear contenedores. En la vista 3D se usa la misma geometría que los cortes DICOM.

El archivo cargado **no se segmenta automáticamente**: el modelo solo visualiza una segmentación ya existente. Los colores, nombres de lesiones y marcadores de la interfaz no son un diagnóstico.



## Tercera vista: RM real + atlas independiente

Consulta [docs/RECONSTRUCCION_REAL.md](docs/RECONSTRUCCION_REAL.md) para el modelo específico del estudio, la selección geométrica de series, la comparación educativa separada y las limitaciones de segmentación.

## Módulo de segmentación precisa desde cortes

El nuevo modo permite pintar sobre los ejes originales, interpolar cortes, guardar revisiones en PostgreSQL y generar superficies GLB, OBJ y STL. Consulta [docs/SEGMENTACION_DESDE_CORTES.md](docs/SEGMENTACION_DESDE_CORTES.md). No detecta tumores ni diseminación automáticamente: es un editor experimental que requiere revisar y validar las máscaras.
