# Auditoría de preparación para producción

Fecha: **2026-10-23**, referencia de usuario America/Caracas.
Código base: `84f3548`; gestor detectado: `pnpm-lock.yaml`, pnpm `11.22.0`.
Alcance: privacidad de claves del usuario, creación de cuenta, WAX/Beekeeper,
idiomas ES/EN/PT, Dokploy, Vercel y Turso.

**Dictamen: todavía no listo para lanzamiento público.** La generación privada
está en el cliente y hay pruebas favorables de WAX, pero la validación global no
está verde y existen huecos de finalidad, secretos del build y operación.
El [roadmap](production-roadmap.md) convierte estos hallazgos en tareas de cierre.
La primera auditoría solo documentó hallazgos; el seguimiento registra las
correcciones iniciales y la nueva evidencia.

## Correcciones iniciales — 2026-10-23

El runtime encontrado durante el seguimiento era Node **24.19.0**. El aviso
oficial incluye la línea 24.x y publica **24.22.1** como versión corregida; entre
los hallazgos altos está CVE-2026-111497, un write fuera de límites en el decoder
Brotli con posibilidad de ejecución remota. Se fijó 24.22.1 en `.nvmrc`,
`.node-version`, `package.json` y la imagen Docker.
[Aviso de seguridad de Node.js](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
[notas de Node.js 24.22.1](https://nodejs.org/en/blog/release/v24.22.1/).

`src/lib/env.ts` ya lee secretos solo desde `process.env`; se quitaron los
accesos al objeto `import.meta.env` en configuración compartida. Una compilación
con cinco canarios sintéticos escaneó los 176 artefactos generados y encontró
cero coincidencias. Dos pruebas cubren lectura runtime y ausencia de valores
requeridos. `pnpm dev` precarga `.env.local` antes de importar el servidor; esa
ruta se probó con un archivo canario temporal. No se usaron valores reales de
`.env.local` para compilar.

Se cambió el texto EN `Ticket verified` a `Access code verified`. La instalación
congelada de Docker también encontró que los permisos de scripts nativos estaban
declarados como texto inválido; `pnpm-workspace.yaml` ahora permite explícitamente
los scripts de `sharp`, `esbuild` y `@tailwindcss/oxide`. El Dockerfile local se
construyó con Node 24.22.1. El contenedor arrancó como usuario `node`, el
reconciliador inició, `/` y `/api/health` devolvieron 200, y el logo optimizado
devolvió `200 image/svg+xml`. Esto no es una publicación en Dokploy.

La suite completa aislada en SQLite temporal quedó en 266/267: sigue fallando
el contrato de `transactionId` de un intento reservado, ya presente en la
auditoría. `astro check`, `tsc` y lint focalizado sobre los archivos de producción
pasan; el lint global continúa abierto. Los avisos de dependencias, el proxy,
restore, broadcast real y el resto del roadmap tampoco quedan cerrados por este
seguimiento.

## Evidencia ejecutada

Las bases de pruebas se crearon en `/tmp/holahive-production-audit-yhERbB/`;
no se reinició ni se migró la base de trabajo. No hubo broadcast real.

| Comprobación                               | Resultado                                                                                        | Alcance y límite                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm exec astro check`                    | Pasa: 325 archivos, 0 errores, 1 hint                                                            | Análisis estático Astro                                                                                                                                                                        |
| `pnpm exec tsc --noEmit`                   | Pasa                                                                                             | Tipos; no prueba runtime                                                                                                                                                                       |
| `pnpm build`                               | Pasa con adapter Node                                                                            | No garantiza imágenes/WASM ni instalación limpia                                                                                                                                               |
| `pnpm test` en SQLite temporal             | 54 archivos pasan, 2 fallan; 263/265 tests pasan                                                 | Contratos, servicios y handlers aislados; no equivale a E2E                                                                                                                                    |
| Repetición de los dos archivos fallidos    | 26/28 tests pasan, mismos 2 fallos                                                               | Confirma que no fue únicamente ruido de la batería                                                                                                                                             |
| `pnpm exec eslint .`                       | Falla: 4.337 errores y 1.152 warnings                                                            | Baseline global; no se declara `pnpm verify` aprobado                                                                                                                                          |
| `pnpm test:simulation` en SQLite temporal  | 2/2                                                                                              | Servicios: reserve→prepare→complete+RC y rollback ante fallo WAX; no HTTP                                                                                                                      |
| `pnpm wax:self-test`                       | Pasa                                                                                             | RPC mainnet, cuenta creadora, claimed accounts, RC, construcción, validación, firma y autoridad; broadcast NO-OP inyectado                                                                     |
| Build Node arrancado con env inyectado     | `/` devuelve 200; worker inicia                                                                  | Proceso local `NODE_ENV=production`; no prueba Dokploy/Traefik                                                                                                                                 |
| Navegador Chromium sobre build Node        | ES/EN/PT: código verificado manualmente → Details → descarga → confirmación → creación → Success | Simulación HTTP real sin mocks del flujo ni broadcast; master oculto inicial y 0 pageErrors. EN: TXT y captura de requests/storage/cookies. ES/PT: además PDF, revelado/copia y scan de DB/log |
| HTTP de idiomas sobre build Node           | 16 peticiones: selección, home, 404, acceso denegado y negociación                               | Home correcta ES/EN/PT; errores públicos ES en EN/PT, q ignorado y alternativa EN afectada por cookie confirmados; no prueba visual                                                            |
| Imágenes HTTP del build                    | Error `MissingSharp`                                                                             | Dependencia nativa/resolución del bundle no lista                                                                                                                                              |
| Scan de secretos de servicio en artefactos | 5 valores en servidor, 0 en cliente                                                              | Comparaciones en memoria y AST; ningún valor fue mostrado                                                                                                                                      |
| `pnpm audit --prod --json`                 | 77 avisos: 2 critical, 37 high, 31 moderate, 7 low                                               | Inventario instalado; falta separar rutas runtime, build y aplicabilidad                                                                                                                       |
| JEV                                        | 1 petición, 6 preguntas                                                                          | Apoyo editorial y orden de trabajo, no certificación técnica                                                                                                                                   |

Logs y arneses temporales son evidencia local de esta ejecución y pueden caducar.
La evidencia durable resumida está aquí; los juicios de JEV y su entrada
minimizada se conservan en [production-audit-jev.json](production-audit-jev.json).

## Privacidad de claves del usuario

El código examinado genera credenciales con WAX en el navegador:
`src/lib/create/get-keys.ts:157`,
`src/lib/details/client-key-session.ts:75` y el script de
`src/components/AccountDetails.astro`. La descarga TXT/PDF se construye localmente;
`src/lib/details/download-handler.ts:39` serializa `PublicKeySet` para confirmar
la descarga. `src/types/keys.ts:10` define únicamente las cuatro claves públicas.
El POST de creación agrega username, PoW y token de tiempo a esas públicas.

Hay tests de no serialización de privadas, storage y atributos DOM
(`src/lib/details/secret-surface.test.ts`), sesión privada con ciclo de vida,
ocultación por defecto y eliminación de referencias al salir. La cookie firmada
vincula usuario, ticket, modo y fingerprint de públicas. Esto favorece la
frontera requerida. Además, el camino feliz EN se recorrió en Chromium contra el
build de producción local, modo simulate y SQLite temporal. Las cinco credenciales
de prueba extraídas del TXT (master y cuatro privadas) no coincidieron con URL o
body de ninguna petición observada, cookies del contexto ni local/session storage.
El master estaba oculto inicialmente y no hubo pageErrors. Los POST observados
tenían estas claves de JSON:

- `/api/create/session`: username, ticket, pow, timingTokenId.
- `/api/create/keys-hash`: ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey.
- `/api/create/account`: username, las cuatro públicas, pow, timingTokenId.

Dos recorridos adicionales completaron ES y PT sobre el mismo build en simulate.
Además de las etapas anteriores, descargaron TXT con cabecera localizada y PDF
válido con las cinco credenciales de prueba, revelaron/ocultaron el master y lo
copiaron al portapapeles verificando igualdad con el TXT. El portapapeles se limpió
y se eliminaron los archivos de descarga. En cada recorrido, cero coincidencias de
esas cinco credenciales en URL/body/headers de requests, cookies, local/session
storage, bytes del archivo production.db y log del servidor. Success conservó el
idioma correcto y no hubo pageErrors. El PDF se comprobó por contenido, sin revisión
visual. El resumen temporal está en browser-i18n-summary.json junto a los logs.

La UI de Success no indicó simulación en ninguno de los tres idiomas, coherente
con F-03. Sigue pendiente cubrir fallos, recuperación, BFCache y el destino
remoto. La comprobación DB/log comparó valores exactos en los archivos inspeccionados;
no es una prueba universal sobre todas las transformaciones, archivos o sistemas
de observabilidad de un despliegue. No se infiere ausencia universal de fugas a
partir de los caminos felices observados.

La afirmación a validar es: **el flujo legítimo no envía al servidor las claves
privadas del usuario**. Las claves operadoras que firman la creación sí pertenecen
al servicio y deben estar en el servidor. Son categorías distintas. JavaScript
no garantiza borrado físico de RAM, y ningún endpoint puede impedir que un cliente
arbitrario envíe bytes sensibles: debe rechazarlos sin reflejarlos ni registrarlos.

### F-01: secretos operativos incrustados en artefactos servidor

**Comprobado en el build base; corregido en el seguimiento.** `src/lib/env.ts:19` usaba acceso
dinámico a `import.meta.env[name]`. El acceso opcional a todo el objeto en
`src/consts/constants.ts:59` también genera un bag de entorno. El build observado
incluye valores de `HIVE_CREATOR_ACTIVE_KEY`, `HIVE_DELEGATOR_POSTING_KEY`,
`SESSION_SECRET`, `BEEKEEPER_WALLET_PASSWORD` y `AUTH_SECRET` en chunks servidor.
AUTH_SECRET solo se detectó al decodificar strings con AST.

En un proceso aislado sin cuatro variables runtime, el helper compilado siguió
devolviendo sus valores de build. Esto permite credenciales antiguas como fallback
y propaga secretos a artefactos/capas de imagen. No demuestra una filtración
pública: 38 archivos cliente y 19 JS analizados por AST dieron cero coincidencias;
las dos rutas probadas hacia chunks servidor devolvieron 404.

El seguimiento quitó el fallback `import.meta.env` y los accesos al objeto
completo de Astro; la lectura ahora es runtime-only. Pruebas runtime pasan y un
build con cinco canarios dio cero coincidencias en 176 artefactos. Falta repetir
la inspección sobre el artefacto exacto que se publique y completar la rotación
operadora de PROD-08.

### F-02: errores de claves reflejan valores no confiables

**Comprobado mediante sentinel sintético.**
`src/utils/key-validation.ts:35` incorpora el valor recibido al error;
`src/pages/api/create/keys-hash.ts:98` lo devuelve. Un valor privado puesto por
error en un campo público puede reflejarse. La detección de campos privados en
`src/types/keys.ts:36` solo reconoce seis nombres top-level y no es una allowlist.
No se observó que el cliente normal envíe privadas.

Cerrar con errores sin valores de claves, campos permitidos explícitos y pruebas
de campos inesperados/anidados. No usar cuerpos de requests como datos de logging.

## Creación, WAX y Beekeeper

El pipeline revisado construye y valida la transacción, verifica contra Hive,
firma con Beekeeper y verifica autoridad antes de pasar al gateway de broadcast.
La simulación suprime transmisión; existe persistencia de intentos, leases,
reconciliación y estado RC. El self-test actual contra `api.hive.blog` pasó con
WAX 2.0.2, firma y autoridad correctas; su broadcast es un NO-OP.

### F-03: éxito antes de confirmación y cierre incompleto

**Trazado estático; no se provocó una expiración real en Hive.**
`src/pages/api/create/account.ts:1248` completa la DB antes de la confirmación.
Aunque `chainConfirmed` sea false, finaliza sesión y responde éxito en `:1263`.
`src/lib/details/account-submit.ts:169` interpreta ese envelope como `created` y
`src/pages/success/[user].astro:115` presenta cuenta lista.

La cuenta puede quedar `broadcasted` y el intento `completed`.
`src/lib/confirm-broadcasted.ts:70` solo retorna false si la evidencia posterior
no es `created`, y `src/lib/creation-reconciler.ts:120` trata `completed` como
terminal. Debe existir una vía explícita de revisión/resolución para expiración
irreversible o falta persistente de evidencia, conservando invariantes de crédito.
El mismo éxito visual se presenta en simulate; impedir ese modo en el release
público sin llenar la UI de detalles de infraestructura.

Esperar irreversibilidad antes de anunciar cuenta lista es una política de release
conservadora propuesta, no una exigencia inherente de Hive: una cuenta puede verse
en un bloque reversible. El defecto trazado es la falta de resolución explícita
si la evidencia posterior de un intento terminal es negativa o inconclusa.

### F-04: dos regresiones/contratos de tests abiertos

- `src/i18n/resolve-locale.test.ts:32`: home exige evitar ticket/Web3, pero
  `src/i18n/en.ts:22` dice `Ticket verified`. Propuesta: `Access code verified`.
- `src/utils/db-ticket-validator.simulation.test.ts:263`: Accounts guarda
  `tx-sim-1`, mientras `getAccountCreationAttempt()` devuelve transactionId null
  en la finalización de un intento reservado. Investigar el contrato entre
  preparación, finalización e idempotencia; no cambiar una aserción para ocultar
  divergencia. El flujo de integración que sí prepara pasó 2/2.

### F-05: Beekeeper conserva el firmante anterior al rotar configuración

**Reproducido con el servicio real y claves sintéticas en `/tmp`, sin red.**
`src/lib/create/beekeeper-service.ts:59` cachea por walletName; `:130` abre un
wallet previo y selecciona su primera pública sin cotejar la clave configurada.
Cambiar configuración A→B mantuvo el firmante A. Reiniciar Beekeeper también
conservó el wallet en disco.

`createBeekeeper()` sin opciones (`:81`) usa filesystem por defecto y wallet no
temporal (`:149`). Son privadas operadoras cifradas, no claves de usuarios.
Elegir memoria/temporal o almacenamiento explícito con comprobación de identidad;
probar rotación, reinicio y concurrencia. El modo actual exige disco escribible.
La [API oficial Beekeeper](https://tools.openhive.network/beekeeper/) describe
persistencia; los defaults exactos se contrastaron con el paquete instalado.

### F-06: navegación de Details pendiente de cobertura

`AccountDetails.astro:968` destruye sesión y aborta listeners en pagehide;
`:999` evita reinicializar formularios marcados. No hay recuperación pageshow.
BFCache es un **candidato**, no un defecto confirmado. Cubrir atrás/adelante,
recarga, cambio de idioma y recuperación sin reutilizar material destruido.

## Copy e idiomas

Catálogos ES/EN/PT: **191 strings por idioma; 573 en total**, sin claves
faltantes/extras/vacías ni diferencias de placeholders en las 12 plantillas.
Es paridad estructural; no demuestra cobertura completa ni revisión lingüística
nativa. Los estados públicos rejected/pending/unknown ya tienen mapeo por códigos.

| Hallazgo                                  | Evidencia                                                                                                                                 | Cierre                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| F-07: páginas de error solo ES            | `src/pages/access-denied.astro:35`, `404.astro:35`, `500.astro:35`                                                                        | Traducir título, explicación, acciones y toast en los tres idiomas                    |
| F-08: 10 páginas privadas sin diccionario | Cuatro Builders, seis Management; `builders/login.astro:16`, `management/access.astro:23`                                                 | Cobertura ES/EN/PT o excepción de alcance documentada                                 |
| F-09: estados mezclados en login          | `src/lib/admin_ui/access-login.ts:30`/`:91` cambia de ES a EN                                                                             | Texto de carga, error y reposo desde el mismo locale                                  |
| F-10: PDF/glosario inconsistente          | `src/i18n/es.ts:234`, `pt.ts:234` mantienen Master Password y `{role} Key:`; `Navbar.astro:34` fija + Post                                | Revisar UI/TXT/PDF completos; preservar nombres propios con criterio explícito        |
| F-11: promesas de permisos excesivas      | `en.ts:242`, ES/PT `:247` dicen que posting comprometida no puede causar pérdida económica; Memo habla genéricamente de mensajes privados | Explicar acciones/transferencias permitidas y memos cifrados, sin garantías absolutas |
| F-12: q ignorado en Accept-Language       | `resolve-locale.ts:20`: `en;q=0,es;q=1 → en`, `en;q=0.1,pt;q=0.9 → en`                                                                    | Respetar pesos y excluir q=0                                                          |
| F-13: alternativa inglesa no determinista | `hreflang.ts:28` omite lang=en, que sí fuerza el selector                                                                                 | Probar enlace EN con cookie previa ES/PT                                              |
| F-14: éxito sin noindex                   | `src/pages/success/[user].astro:68` no pasa prop noindex                                                                                  | Verificar robots en respuesta; no-store no sustituye noindex                          |

Los textos `masterPasswordPrivacy` y `masterPasswordHelp` existen en los tres
catálogos pero no se renderizan. Si la interfaz debe explicar privacidad antes
de continuar, hay que usar copy visible, no contar strings sin uso como cobertura.

Referencias para permisos y respaldo: [Hive Welcome](https://hive.blog/welcome)
y [operaciones Hive](https://developers.hive.io/apidefinitions/broadcast-ops.html).

Propuestas editoriales para implementar y revisar visualmente:

| Intención         | ES                                                                                                                | EN                                                                                                        | PT                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Código confirmado | Código de acceso verificado                                                                                       | Access code verified                                                                                      | Código de acesso verificado                                                                                        |
| Privacidad        | Tus claves privadas se generan en este navegador. Este flujo envía solo las claves públicas para crear tu cuenta. | Your private keys are generated in this browser. This flow sends only public keys to create your account. | Suas chaves privadas são geradas neste navegador. Este fluxo envia apenas as chaves públicas para criar sua conta. |
| Pendiente         | Solicitud enviada. Estamos comprobando la confirmación antes de que inicies sesión.                               | Your request was sent. We are checking confirmation before you sign in.                                   | Solicitação enviada. Estamos verificando a confirmação antes de você entrar.                                       |

Estas son propuestas; no están aplicadas ni constituyen revisión nativa ES/EN/PT.
El copy de pendiente que dice «estamos comprobando» requiere implementar una
comprobación activa o explicar cómo reintentar el mismo intento: la UI actual no
hace polling tras pending. JEV escogió el significado entre candidatos dados;
la implementación debe sostener esa promesa antes de publicarla.

## Dependencias y artefacto de producción

### F-15: avisos de seguridad abiertos

`pnpm audit --prod` reporta 77 avisos sobre dependencias instaladas. La ubicación
en dependencies no prueba que cada ruta sea alcanzable desde HTTP; hay herramientas
de build entre ellas. Debe analizarse cada advisory y actualizar con regresiones.

Los dos críticos son:

- Astro instalado 7.2.3, afectado por
  [GHSA-26w7-cxv4-gfx2](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2).
  La condición descrita es procesamiento de AVIF no confiable por el servicio de
  imagen; parche inicial 7.2.8 y Sharp 0.35.4. No se ejecutó un exploit ni se probó
  que el sitio permita suministrar ese AVIF. Revisar también avisos posteriores;
  actualizar solo al mínimo de este advisory no cierra el inventario.
- tar 7.4.3, vía `@tailwindcss/vite → @tailwindcss/oxide → tar`, incluido en
  [GHSA-23hp-3jrh-7fpw](https://github.com/isaacs/node-tar/security/advisories/GHSA-23hp-3jrh-7fpw).
  Afecta extracción de archivos no confiables; parche 7.5.19. No se encontró aquí
  una ruta pública de extracción ni se provocó agotamiento de recursos.

### F-16: imágenes corregidas en contenedor local; release aún incompleto

La imagen del logo falló con MissingSharp en el build Node original. El cierre
inicial configuró explícitamente los scripts nativos permitidos por pnpm para
Tailwind, esbuild y Sharp. Una instalación congelada y limpia dentro de la imagen
Linux ya devuelve `200 image/svg+xml` para `/_image` del logo.

Falta probar el resto de imágenes en la instalación/release de Dokploy. El permiso
para scripts de dependencias queda deliberadamente explícito y debe revisarse al
actualizar paquetes.
Fuentes: [MissingSharp de Astro](https://docs.astro.build/en/reference/errors/missing-sharp/)
y [Sharp con bundlers](https://sharp.pixelplumbing.com/install/#bundlers).

## Despliegue y datos

### F-17: contenedor local validado; Dokploy aún no probado

`astro.config.mjs:35` configura Node standalone. `scripts/start-server.ts:11`
inicializa DB y arranca el reconciliador antes del entrypoint; `pnpm start` necesita
scripts/src/tsconfig/tsx además de dist y dependencias. Un contenedor que solo ejecute
`node dist/server/entry.mjs` perdería ese bootstrap.

El Dockerfile fija Node 24.22.1, instala con lockfile congelado, ejecuta el
bootstrap como usuario `node` y declara `/data` como volumen para SQLite. La
readiness `/api/health` consulta la DB sin contactar Hive. Se verificaron localmente
build Linux, arranque, home, salud e imagen del logo. Para producción siguen
pendientes named volume configurado en Dokploy, una réplica, variables inyectadas,
HTTPS/proxy, parada/reinicio y respaldo/restauración de SQLite/WAL.
Dokploy documenta backups de named volumes y recomienda detener escrituras:
[mounts/healthchecks](https://docs.dokploy.com/docs/core/applications/advanced),
[backups](https://docs.dokploy.com/docs/core/volume-backups).

### F-18: entorno, proxy y URL de autenticación

El arranque fuente no carga `.env.local`; la DB lee process.env al importar.
Documentar inyección previa al proceso, no depender del archivo del workspace.
`src/lib/auth.ts:9` cae en localhost si no hay BETTER_AUTH_URL/AUTH_URL;
esas variables no figuran en `.env.example`. Probar Origin, trusted origins,
cookies Secure y login/logout detrás del proxy real.

Rate limit, desafíos PoW y tokens de tiempo están en memoria. Varias réplicas o
funciones pueden repartir emisión y validación entre procesos incompatibles.
`TRUST_PROXY_HEADERS` requiere headers saneados por el proxy y contenedor sin
acceso directo; aceptar headers de cliente no prueba IP auténtica.
Fuente runtime: [adapter Node](https://docs.astro.build/en/guides/integrations-guide/node/).

### F-19: Turso remoto existe en configuración, falta ensayo remoto

`src/lib/database-config.ts:27` acepta conexión remota directa con token y rechaza
embedded replicas/sync. La transacción dedicada es una base útil; pruebas locales
no validan latencia remota. El init ejecuta decenas de sentencias secuenciales en
una transacción: Turso documenta timeout interactivo de 5 segundos.

No hay migraciones incrementales generales; el esquema incompatible falla de forma
explícita y el convertidor v1→v2 acepta SQLite local. Ensayar importación/corte,
concurrencia del último ticket, rollback, leases y pérdida de conexión en Turso
desechable. Restaurar DB no revierte Hive: reconciliar antes de devolver créditos.
Fuentes: [transacciones](https://docs.turso.tech/sdk/ts/reference#interactive-transactions),
[importación](https://docs.turso.tech/cloud/migrate-to-turso),
[PITR](https://docs.turso.tech/features/point-in-time-recovery), que restaura a otra DB.

### F-20: Vercel + Turso requiere adaptar ejecución

La configuración no incluye adapter Vercel. Además del adapter y DB remota,
resolver Beekeeper/WASM, filesystem, worker durable y estado compartido de
protecciones públicas. `setInterval` y trabajo RC sin esperar no garantizan
ejecución posterior a una función. `/tmp` es efímero; no resuelve SQLite durable.

El cron Hobby nativo documentado es diario, insuficiente para sustituir el ciclo
actual de 5 minutos. Elegir worker externo o plan/programación adecuada y medir
cold start, concurrencia, tamaño y tiempo máximo en el plan elegido. Esta auditoría
no desplegó una función ni validó Turso real.
Fuentes: [adapter Astro Vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/),
[filesystem/runtime](https://vercel.com/docs/functions/runtimes),
[cron](https://vercel.com/docs/cron-jobs/usage-and-pricing),
[límites de funciones](https://vercel.com/docs/functions/limitations).

## Uso de JEV y ahorro de peticiones

Se consultaron docs oficiales de [API](https://docs.typesafe.ai/api),
[Choice](https://docs.typesafe.ai/primitives/choice) y
[fan-out](https://docs.typesafe.ai/patterns/fan-out). Una petición agrupó seis
juicios independientes sobre resúmenes mínimos y candidatos de copy; no se enviaron
claves, cookies, valores env, cuerpos de requests de usuarios ni código completo.

Respuesta: `jev-1.14.0`, **1.454 tokens de entrada y 282 de salida**.
Los seis Choice devolvieron confianza 1 dentro de sus alternativas:

| Pregunta                          | Selección                                                  | Uso                                              |
| --------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| Copy para broadcast sin confirmar | Solicitud enviada; comprobando confirmación                | Evitar prometer cuenta lista                     |
| Copy de privacidad                | Generación en navegador y envío de públicas                | Describir frontera sin garantía absoluta         |
| Permisos Posting                  | Acciones acotadas, sin transferencias directas HIVE/HBD    | Eliminar promesa absoluta de ausencia de pérdida |
| Glosario de acceso                | Access code verified y equivalentes ES/PT                  | Unificar terminología                            |
| Estado de traducción              | Paridad de catálogo, superficies incompletas               | No declarar i18n completo                        |
| Orden de release                  | Cerrar flujo/privacidad/copy y un Node persistente primero | Priorizar roadmap                                |

La confianza no representa probabilidad de que el proyecto sea seguro.
Se guardaron entrada y salida para reutilización; no hace falta repetir la llamada
mientras las observaciones y preguntas sigan vigentes. El resto de esta auditoría
se basó en código, checks, reproducciones y documentación primaria.

## Fuera de la evidencia actual

Sin despliegue en Dokploy/Vercel, sin pruebas contra Turso real, sin broadcast de
una cuenta nueva ni ejercicio de restore remoto. Sin revisión lingüística nativa
completa, auditoría de accesibilidad/visual completa, prueba de carga o pentest.
Los hallazgos históricos se contrastaron con código actual; no se consideran
pruebas actuales las ejecuciones de sesiones anteriores.
