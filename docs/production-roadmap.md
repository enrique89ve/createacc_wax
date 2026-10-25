# Roadmap de producción

Actualizado: **2026-10-23**. Base auditada: `84f3548`.

**Estado: no listo para lanzamiento público.** El núcleo funciona parcialmente
y hay pruebas locales favorables; faltan cierres de seguridad, estado de creación,
copy y operación. Este documento es el backlog de salida de fase 1 del README.
La [auditoría](production-readiness-audit.md) contiene evidencia y límites.

## Decisión de despliegue propuesta

Validar primero **Dokploy + Node persistente + SQLite, una réplica**. Turso remoto
es una alternativa a validar contra una base de prueba. Vercel + Turso es viable
con adaptación de runtime, firma y worker; no es un cambio exclusivo de DB.
Esta recomendación no cambia la infraestructura ni obliga a contratar servicios.

| Destino                | Estado                                          | Falta para considerarlo preparado                                                                                          |
| ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Dokploy + SQLite       | Arquitectura compatible; sin despliegue probado | Imagen reproducible, volumen, readiness, proxy HTTPS, restauración y worker tras reinicio                                  |
| Dokploy + Turso remoto | Soportado por configuración; sin prueba remota  | Imagen/readiness/proxy/worker y pruebas de concurrencia, latencia, timeout, migración y restore de la DB remota            |
| Vercel + Turso remoto  | Viable condicionado a implementación            | Adapter Vercel, WAX/Beekeeper sin FS persistente, worker durable, PoW/timing/rate limit compartidos y prueba de cold start |
| Vercel + SQLite local  | Inadecuado para estado durable                  | Cambiar a DB remota; `/tmp` no ofrece persistencia                                                                         |

## P0: bloquean el lanzamiento

P0 identifica un bloqueo de salida; no significa que se haya probado explotación.
Cada tarea se cierra con evidencia nueva, no por haber escrito documentación.

| ID      | Trabajo                                                      | Criterio de cierre                                                                                                                                                                                                                                         | Estado                                                                                                                                      |
| ------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-01 | Resolver avisos de dependencias, empezando por Astro/Sharp   | Actualizar a versiones corregidas compatibles; revisar alcance de los 77 avisos actuales; documentar aplicabilidad de los restantes y repetir audit/build/HTTP. No basta fijar únicamente el mínimo de un aviso                                            | Pendiente; versiones afectadas detectadas                                                                                                   |
| PROD-02 | Eliminar secretos incrustados en el build servidor           | Secretos operativos solo runtime; build sin credenciales reales; escaneo de artefactos con valores canario y comprobación de que runtime B no reutiliza A. Sin coincidencias en archivos cliente ni servidor                                               | Lectura runtime probada; build canario: 0/176 artefactos. Falta validar imagen publicada/rotación operadora                                 |
| PROD-03 | Completar evidencia de privacidad del usuario                | Capturar red de generación, revelado, copia, TXT/PDF, confirmación, creación, fallo y recuperación. Cero privadas/master en requests, cookies, storage, logs y DB. Repetir en artefacto desplegado y ES/EN/PT                                              | Parcial: camino feliz browser ES/EN/PT; TXT/PDF/revelado/copia y scan DB/log en ES/PT. Fallos, recuperación y destino desplegado pendientes |
| PROD-04 | Cerrar semántica de broadcast, confirmación y reconciliación | No presentar cuenta utilizable antes de evidencia suficiente. Resolver intentos `completed` con cuenta `broadcasted` que luego expiran o requieren revisión; probar sin doble consumo ni compensación prematura                                            | Pendiente; hueco identificado por trazado de código                                                                                         |
| PROD-05 | Recuperar una validación de release verde                    | Resolver el test fallido de `transactionId`; obtener `pnpm verify` verde. Separar artefactos ajenos del lint y corregir deuda real con una política revisable                                                                                              | Copy EN corregido; 266/267 tests en DB temporal. Sigue abierto el contrato `transactionId` y el lint global                                 |
| PROD-06 | Preparar y probar el release Dokploy                         | Imagen con Node 24.22.1, pnpm fijado, instalación congelada, bootstrap `scripts/start-server.ts`, env inyectado, una réplica y DB SQLite en volumen. Readiness local sin depender de RPC Hive, HTTPS/cookies/proxy, reinicio, redeploy y restore validados | Build y contenedor locales pasan; Dokploy/proxy y restore siguen pendientes                                                                 |
| PROD-07 | Ensayo controlado real en Hive                               | Tras PROD-01…06 y P1 de lanzamiento: una creación autorizada con claves de prueba, autoridades públicas correctas, evidencia irreversible, consumo único, RC y recuperación tras interrupción                                                              | Sin ejecutar; esta auditoría no hizo broadcast                                                                                              |

## P1: completar antes de exponer el producto

| ID      | Trabajo                                 | Criterio de cierre                                                                                                                                                                                                                                         | Dependencia                                                                                                    |
| ------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PROD-08 | Firma operadora y rotación Beekeeper    | Elegir almacenamiento explícito; comprobar que rotar A→B firma con B, tras reinicio y con concurrencia; ningún wallet viejo seleccionado por nombre                                                                                                        | PROD-02                                                                                                        |
| PROD-09 | Imágenes en runtime                     | Corregir Sharp nativo/empaquetado; `/_image` del logo y apps devuelve imagen válida en instalación limpia Linux y contenedor final                                                                                                                         | Logo `/_image` devuelve 200 en contenedor Linux; falta validar todas las imágenes en instalación/release final |
| PROD-10 | Copy completo ES/EN/PT                  | Traducir 404/500/acceso denegado, estados y descargas. Aprobar glosario, permisos Posting/Memo y mensajes pending/unknown/confirmed; revisar todo texto visible, incluido Builders/Management, y comprobar móvil ES/EN/PT sin recortes ni acciones ocultas | PROD-04                                                                                                        |
| PROD-11 | Errores sin material sensible           | Validar allowlist de campos y no reflejar valores recibidos como claves. Pruebas con campos inesperados, privadas en campo público y objetos anidados                                                                                                      | Cierra parte de PROD-03                                                                                        |
| PROD-12 | Migración, backup, restore y alertas    | Runbook por destino; restaurar a DB/volumen nuevo, reconciliar Hive antes de liberar tickets; alertar pendientes antiguos, worker fallido y manual_review                                                                                                  | PROD-04, PROD-06                                                                                               |
| PROD-13 | Configuración de producción verificable | `HIVE_TX_MODE=broadcast` explícito para lanzamiento; impedir una publicación accidental en simulate. DB de ensayos aislada, `BETTER_AUTH_URL` HTTPS documentada y secretos inyectados antes de imports                                                     | PROD-02, PROD-06                                                                                               |

## P2: compatibilidad y cobertura adicional

| ID      | Trabajo                               | Criterio de cierre                                                                                                                                                                                             |
| ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROD-14 | Negociación y SEO de idiomas          | Respetar pesos q y excluir q=0; alternativa EN determinista con cookie ES/PT; `noindex` en success; revisión visual de copy largo en móvil                                                                     |
| PROD-15 | Navegación y ciclo de vida de Details | Probar recarga, atrás/adelante, BFCache, cambio de idioma, cierre de pestaña y recuperación; no reutilizar claves destruidas ni dejar formulario inerte. BFCache sigue siendo candidato sin reproducción       |
| PROD-16 | Validar Turso remoto                  | Base desechable; último ticket desde procesos independientes, rollback, FK, leases, caída de conexión y arranque dentro de límites de transacción. Conversión/exportación/importación y restauración ensayadas |
| PROD-17 | Adaptar Vercel si se elige            | Adapter y runtime Node, inclusión WASM, Beekeeper en memoria/temporal, worker autenticado independiente del tráfico web, estado compartido para PoW/timing/rate limit y pruebas de cold start/concurrencia     |

PROD-16/17 pasan a bloquear la salida si se elige esa plataforma. La cobertura de
idiomas solicitada incluye las superficies de administración; si el producto
decide operarlas solo en español, registrar esa excepción antes de cerrar PROD-10.

## Orden de ejecución

1. PROD-01/02: dependencias y artefactos sin secretos.
2. PROD-04/05/08/11: estado de creación, contratos y firma operadora.
3. Validación local preliminar PROD-03/09/10/13: navegador, imágenes, copy y configuración efectiva.
4. PROD-06/12: Dokploy, persistencia, proxy, restore y alertas; cierre de PROD-03/09 en el artefacto desplegado. Si se elige Turso/Vercel, cerrar PROD-16/17 aquí.
5. PROD-07: ensayo real controlado y aprobación de salida a fase 2.
6. PROD-14/15: cobertura adicional; PROD-16/17 solo pueden posponerse si no forman parte del destino de release.

Se pueden ejecutar copy y empaquetado en paralelo, conservando estas dependencias.
No se asignan fechas sin medir los cierres y disponer del destino de pruebas.

## Evidencia mínima para aprobar un release

- [ ] `pnpm verify`, build y audit evaluados sobre el commit de release.
- [ ] Instalación congelada y arranque de la imagen final, incluidos WASM e imágenes.
- [ ] Flujo real de navegador y captura de no transmisión de privadas.
- [ ] Copy revisado en ES/EN/PT, incluido error, espera, recuperación, TXT y PDF.
- [ ] Secretos runtime, rotación operadora y artefactos sin sus valores.
- [ ] Último ticket concurrente, doble clic, retry y reinicio sin doble consumo.
- [ ] Restore aislado y reconciliación posterior contra Hive.
- [ ] Proxy/Origin/cookies y política de IP comprobados en el destino.
- [ ] Broadcast controlado, finalidad irreversible y delegación RC verificados.
- [ ] Sin P0 abiertos ni P1 de lanzamiento sin resolver.

## Mantenimiento

Tras cada cierre, registrar commit, comando/entorno, resultado y límite de la
evidencia en la auditoría; actualizar estado de la fila y resumen del README.
Los resultados actuales de JEV están [guardados](production-audit-jev.json):
reutilizarlos mientras no cambien observaciones, candidatos o preguntas. No usar
JEV para aprobar criptografía, permisos, saldo, finalidad o despliegues.
