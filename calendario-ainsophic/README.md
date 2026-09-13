# Ainsophic — Calendario estratégico (editable)

Calendario interno, 100% estático (HTML + CSS + JS puro, sin frameworks ni
build step), con vistas de **Año / Mes / Día / Agenda**, alta / edición /
baja de eventos, y respaldo manual de los datos.

## Archivos

```
index.html    → estructura + estilos (todo el CSS va inline, como el original)
app.js        → toda la lógica (vistas, datos, formularios)
events.json   → semilla de datos inicial ("de fábrica"): los 22 eventos actuales
README.md     → este archivo
```

No hay build step. Es literalmente "copiar la carpeta al servidor".

## Probarlo en local antes de desplegar

`app.js` carga `events.json` con `fetch()`. Los navegadores **bloquean esa
carga si abrís `index.html` con doble clic** (protocolo `file://`), así que
para probarlo local necesitás un servidor mínimo:

```bash
cd calendario-ainsophic
python3 -m http.server 8080
# abrir http://localhost:8080
```

Si ves un cartel rojo de error al abrir la app, es casi siempre esto (o que
`events.json` no está al lado de `index.html`).

## Desplegar con nginx

Copiá la carpeta completa a donde sirva nginx, por ejemplo:

```bash
sudo mkdir -p /var/www/ainsophic-calendario
sudo cp index.html app.js events.json /var/www/ainsophic-calendario/
```

Bloque de servidor mínimo:

```nginx
server {
    listen 80;
    server_name calendario.interno.local;   # ajustar

    root /var/www/ainsophic-calendario;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # evitar que el navegador cachee agresivamente durante actualizaciones
    location ~* \.(html|json)$ {
        add_header Cache-Control "no-cache";
    }
}
```

### Es un dato privado corporativo — pensá el acceso

La app en sí **no tiene login**. Si "uso interno privado" significa que no
cualquiera con la URL debería poder editar o ver los eventos, sumale al
`server{}` autenticación básica (`auth_basic`) o restringí por red/VPN/IP.
Eso no lo agregué porque no lo pediste explícitamente, pero para un
calendario estratégico de la empresa (fechas de lanzamientos, etc.) es la
recomendación estándar antes de exponerlo aunque sea en la red interna.

## Cómo se guardan los datos (importante leer esto)

- Al abrir la app por primera vez en un navegador, carga `events.json` y
  lo copia a `localStorage` de ese navegador.
- Desde ahí, **todo alta/edición/baja se guarda solo en `localStorage` de
  ese navegador/equipo**, automáticamente, sin que hagas nada.
- `events.json` en el servidor no se vuelve a tocar solo. Es la semilla y
  el "reset de fábrica".

**Limitación real, dicha sin vueltas:** esto no es una base de datos
compartida. Si dos personas del equipo abren la misma URL desde dos
computadoras distintas, cada una edita **su propia copia local**; los
cambios de una no aparecen automáticamente en la otra. Para un calendario
de uso realmente colaborativo (varias personas editando y viendo lo mismo
en simultáneo) esto no alcanza — ver "Si necesitan más" más abajo.

Si lo que necesitás es que **una sola persona (o un grupo chico, a mano)
mantenga el calendario al día** y el resto lo consulte, este esquema
funciona bien.

## El flujo de "dump" que pediste

Botones en la barra superior:

- **Exportar copia (.json)** — descarga un archivo
  `ainsophic-calendario-dump-<fecha>.json` con todos los eventos actuales
  tal cual están en ese navegador. Esto es tu backup manual: guardalo en
  un repo, Drive, donde ya respalden otras cosas de la empresa.
- **Importar copia (.json)** — reemplaza los eventos actuales por los de
  un archivo exportado antes (pide confirmación porque es destructivo).
- **Restaurar datos originales** — vuelve a los 22 eventos de
  `events.json` tal como está en el servidor, descartando ediciones no
  exportadas (también pide confirmación).

Recomendación de rutina: exportar una copia cada tanto (semanal, o
después de una tanda de cambios importante) y guardarla versionada. Si en
algún momento querés que **ese dump sea el nuevo punto de partida para
todo el equipo**, reemplazá `events.json` en el servidor por el archivo
exportado (incluso podés dejarlo con ese nombre) y pedile a cada persona
que use "Restaurar datos originales" una vez.

## Si necesitan más (varias personas editando en tiempo real)

Esto queda fuera de lo que pediste ("app estática"), pero para ser
honesto con las opciones: si en algún momento el calendario necesita que
los cambios de una persona los vea el resto sin este paso manual de
exportar/reemplazar, la app estática con `localStorage` deja de alcanzar
por diseño — no es un límite de esta implementación puntual, es un límite
de cualquier sitio 100% estático. Las rutas típicas desde acá, sin que
ninguna sea "la correcta" de antemano:

- Un backend chico (Node/Express o Python/Flask, por ejemplo) con
  SQLite o incluso un `events.json` en disco que la app llame por API en
  vez de `localStorage` — es la opción con menos piezas nuevas, nginx
  pasaría a hacer de proxy reverso hacia ese servicio.
- Un backend gestionado (Firebase, Supabase, etc.) si no quieren operar
  un servidor propio — más rápido de armar, pero suma una dependencia
  externa y, según el dato, puede no ser aceptable para "uso interno
  privado corporativo".
- Mantener todo como está pero con disciplina de proceso: una persona
  designada como dueña del calendario, que exporta/reemplaza
  `events.json` en el servidor cada vez que hay cambios — cero código
  nuevo, pero depende de que ese paso manual no se salte.

No implementé ninguna de estas porque no fue lo pedido, pero si el uso
real termina siendo multi-persona editando seguido, vale la pena decidir
esto explícitamente en vez de descubrirlo por las malas (alguien
sobrescribe sin querer el trabajo de otro).

## Extender el modelo de datos

Cada evento es un objeto con estos campos (todos de texto libre excepto
`score` y `done`):

```json
{
  "id": "auto-generado desde el título",
  "date": "YYYY-MM-DD",
  "title": "string",
  "entity": "string (con sugerencias: SAS, Foundation, SAS + Research Labs, Externo)",
  "type": "string (con sugerencias: Ainsophic, Mendoza, Argentina, Global)",
  "priority": "string (con sugerencias: P0, P1, P2, P3)",
  "score": 0,
  "action": "string (con sugerencias: GO, PARTNER, WATCH, BLACKOUT, CONDITIONAL)",
  "city": "string",
  "product": "string",
  "status": "string libre",
  "summary": "string",
  "strategy": "string",
  "tasks": ["array de strings"],
  "source": "URL opcional",
  "done": false
}
```

Los campos con "sugerencias" son `<input>` con `<datalist>`: podés escribir
cualquier valor nuevo (por ejemplo una entidad que todavía no existe) y
queda disponible como sugerencia la próxima vez, sin tocar código.
