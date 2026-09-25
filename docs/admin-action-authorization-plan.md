# Plan de autorización contextual administrativa

Fecha: 2026-09-25. Base inspeccionada: `146271f`.
Estado: diseño en ocho commits; todavía sin implementación ni commits creados.

## Resultado esperado

Cada acción administrativa expresa qué pretende hacer el actor sobre un recurso,
consulta hechos actuales del servidor, devuelve una decisión explicable y registra
el efecto confirmado. Un Admin no puede saltarse condiciones contables, propiedad
de tickets Builder o evidencia de Hive por tener el rol.

El usuario confirmó expresamente esta regla: **mientras exista un intento de
reclamación vigente, Admin no puede reducir créditos pendientes**. Sí puede
aumentarlos o ajustar disponibles, con motivo y control de concurrencia.

El análisis y sus fuentes están en `docs/admin-action-authorization-analysis.md`.
Este plan se contrastó con `typescript-senior`, `ts-grill` y `ts-architect`.
Las recomendaciones restantes son decisiones de diseño de este plan, no cambios
ya ejecutados ni aprobaciones de despliegue.

## Decisiones de diseño

1. Mantener roles Admin/Builder y la matriz existente como control de facultades.
   Distinguir asignar, ajustar, bloquear, reactivar, emitir y consultar.
2. Un único catálogo de acciones en `src/lib/auth/permissions.ts`; el comando
   administrativo usa un subconjunto de ese catálogo, sin strings paralelos.
3. Operaciones administrativas locales en TypeScript. El módulo público recibe
   actor autenticado y comando validado; las políticas puras quedan dentro del
   módulo. Nada de OPA remoto, DSL de políticas o motor de workflows en esta serie.
4. Los datos de identidad, propiedad, bloqueo, financiación, saldos e intents los
   carga el servidor. Un tipo TypeScript no convierte datos del navegador en hechos.
5. Lectura de hechos, comprobación, escritura y auditoría del efecto comparten
   transacción. Reutilizar `withTransaction` y su propagación actual del executor;
   no crear otro administrador de transacciones.
6. Ajustes absolutos requieren `expectedRevision`. Todas las escrituras de Credits
   incrementan una revisión monotónica; detectar cambios intermedios aunque los
   números hayan vuelto al mismo valor. `updated_at` no es un token suficiente.
7. Motivo obligatorio, recortado y no vacío, para ajuste, bloqueo y reactivación.
   Usar el máximo existente de 500 caracteres del ajuste, sin texto genérico
   introducido silenciosamente por el cliente o el servidor.
8. Nuevas asignaciones a usernames bloqueados se rechazan según la regla propuesta
   de esta serie. Correcciones contables siguen disponibles con motivo; bloquear
   no borra ni confisca saldos, tickets o historial. Reactivar es una acción separada.
9. Mutaciones con identificador de solicitud para repetir una respuesta perdida
   sin repetir el efecto. Un cambio de contenido exige un identificador nuevo.
10. Auditoría administrativa complementaria al ledger de Credits y TicketAudit.
    No sumar esa auditoría como movimientos contables ni reconstruir balances con ella.
11. La interfaz del panel explica restricciones y conflictos. El servidor reevalúa
    siempre la ejecución; una previsualización no es una autorización persistente.
12. No modificar máximos numéricos, crear presupuestos globales, agregar roles,
    imponer MFA o doble aprobación como parte de esta serie.

## Inventario y restricciones comprobadas

- `src/lib/auth/permissions.ts`: aliases `ASSIGN_CREDITS → MANAGE_CREDITS` y
  `MANAGE_ALL_CREDITS → ADMIN_ADJUSTMENTS`; autorización basada en rol.
- `src/lib/auth/admin-auth.ts`, `src/lib/session-helpers.ts`, `src/lib/auth.ts`:
  sesión Better Auth con caché de cookie configurada. La versión instalada ofrece
  `disableCookieCache`; no basar una mutación sensible solo en `locals` precargados.
- `src/pages/api/management/users.ts`: listado, asignación inicial y bloqueo.
- `src/pages/api/management/users/[username]/credits.ts`: asignar y ajustar.
- `src/pages/api/management/users/[id].ts`: segundo acceso a bloqueo y PATCH 410.
- `src/pages/api/management/users/[id]/reactivate.ts`: reactivar.
- `src/pages/api/management/tickets.ts`: emitir y listar tickets.
- Diagnósticos: tanto `src/pages/api/management/database/diagnose.ts` como
  `src/pages/api/builders/credits/diagnose.ts` son entradas administrativas.
- Las páginas `management/*.astro` también leen repositorios directamente; aplicar
  permisos por acción ahí, no solo en rutas JSON.
- `src/lib/credits/core.ts` concentra las siete sentencias de escritura de Credits
  encontradas en runtime. Inventariarlas otra vez antes de añadir la revisión.
- `src/lib/credits/claim-service.ts`: vigencia `expires_at > now`, TTL actual de
  diez minutos. Los intents son snapshots, no reservas acumulables de saldo.
- `src/scripts/management/builders.ts`: ajuste envía ambos valores absolutos y
  sustituye motivos vacíos. Bloqueo/reactivación no envían motivo ni request ID.
- Límites de asignación dispares: panel 100, PATCH 10000, constante/POST 100000.
  Preservar estos máximos en esta serie y hacerlos explícitos en las validaciones
  de cada entrada; una unificación numérica es una decisión de producto separada.
- El schema guard rechaza estructuras/versiones incompatibles. No hay migraciones
  incrementales durante el arranque. `docs/database-operations.md` exige conversión
  offline ensayada sobre copia y prohíbe resetear datos a preservar.

## Contratos y orden de ejecución

### Comandos y resultados

La unión discriminada de comandos relaciona cada acción con su contenido exacto:

| Acción conceptual | Datos del comando, además de request ID |
| --- | --- |
| Asignar créditos | Username e importe explícito; origen administrativo fijado por servidor |
| Ajustar créditos | Username, campos a modificar, expectedRevision y motivo |
| Bloquear / reactivar | Username, expectedModerationRevision y motivo |
| Emitir ticket de sistema | Código, usos y descripción; financiación/emisor fijados por servidor |

No aceptar `actor`, `role`, `fundingSource` ni saldos actuales como autoridad desde
el cuerpo. Validar JSON como `unknown`, discriminar acción y rechazar parámetros
ilegales. En ajustes, enviar solo campos modificados y al menos uno.

Resultados de dominio: aplicado, sin cambio, prohibido, conflicto o no encontrado.
Resultados HTTP: 400 entrada inválida; 401 sin sesión válida; 403 falta de facultad;
404 recurso de ajuste inexistente; 409 conflicto de revisión, claim vigente o
reutilización incompatible de ID; 500/503 error interno o dependencia indisponible.
No convertir fallos de BD en listas vacías, permisos concedidos ni falsos 401.

Códigos estables, por ejemplo `PENDING_CLAIM_ACTIVE`, `STALE_CREDIT_REVISION`,
`STALE_MODERATION_REVISION`, `TARGET_BLOCKED`, `IDEMPOTENCY_CONFLICT` y
`REASON_REQUIRED`. Son propuestas de contrato, no mensajes existentes.

### Mutaciones

1. Validar origen de solicitud y sesión actual, omitiendo caché de cookie para
   estas mutaciones. El resolver distingue sesión ausente de fallo de dependencia.
2. Validar el comando; derivar acción desde la entrada del servidor.
3. Abrir transacción y verificar que el Admin sigue activo y tiene esa facultad.
4. Buscar recibo confirmado para `(actor_user_id, request_id)`.
5. Si existe con mismo contenido normalizado, devolver el resultado original
   identificado como repetición. Si cambió acción, objetivo, motivo, revisión o
   contenido, responder conflicto. El recibo no concede acceso a otro actor.
6. Si no existe, leer hechos actuales y evaluar revisiones/condiciones.
7. Ejecutar mediante primitivas de dominio existentes; mantener sus invariantes.
8. Insertar auditoría de dominio y recibo administrativo en la misma transacción.
9. Confirmar; emitir notificación de asignación después de commit, solo para un
   efecto nuevo. Mantener su semántica actual de mejor esfuerzo; no prometer
   entrega exactamente una vez ni agregar un outbox en este alcance.

Las denegaciones y conflictos se registran estructuradamente con el logger fuera
del rollback. El nuevo registro durable en BD acredita efectos confirmados y
operaciones sin cambio; no se presenta como almacenamiento durable de todos los
intentos denegados. Eliminar cookies, contraseñas, claves y cuerpos completos de logs.

### Regla de reclamación aprobada

Dentro de la transacción, capturar el reloj del servidor una vez y consultar si
existe algún intent del username con `expires_at > now`. Si hay uno y el nuevo
pending es menor que el pending actual, devolver conflicto sin mutación.

Permitir aumento, mantener pending igual o modificar solo disponibles, sujetos
a motivo, límites y revisión. Un intent vencido no activa esta condición. No
eliminar, cancelar, consumir o extender intents desde la acción Admin. No sumar
sus amounts ni reinterpretarlos como saldo reservado. Las reglas de verificación
Hive y `expired_irreversible` permanecen en su módulo actual.

Si claim completa primero, cambia la revisión y el ajuste viejo da conflicto.
Si ajuste compite antes con un intent vigente, la reducción se rechaza. Si la
reducción confirma antes de que se cree el intent, este lee el saldo reducido.

## Persistencia

- Añadir `Credits.revision`, entero no negativo con valor inicial 0. Incrementar
  en cada mutación real de sus importes/contadores, incluidos UPSERT de grants,
  claim, compra de ticket, consumo, devolución y ajustes. Una repetición o no-op
  no incrementa revisión. Propagar el campo a DTO, listado y formulario.
- Añadir `AdminActionLog` con ID monotónico, request ID, actor ID estable, snapshot
  de username, acción, tipo/ID del objetivo, hash del comando normalizado, versión
  de política, motivo, estado anterior/posterior, resultado aplicado/sin cambio,
  recibo tipado serializado y fecha. Unicidad `(actor_user_id, request_id)`.
- El hash incluye acción, objetivo y todos los parámetros significativos; usar
  serialización explícita por comando. La unicidad global por actor también
  detecta reutilizar el mismo ID para una acción diferente.
- `moderationRevision` se deriva del último ID aplicado de bloqueo/reactivación
  para ese username, o 0 si no hay eventos nuevos. Así sobrevive a eliminar la fila
  de bloqueo. Los no-op y las asignaciones no cambian esta revisión. Indexar la
  consulta y realizar lectura/transición/inserción del evento en la misma transacción.
- Mantener `BlockedHiveAccounts` como estado actual; los eventos nuevos conservan
  historia. No inventar eventos antiguos al convertir la BD. Los bloqueos actuales
  empiezan en revisión 0 con sus datos originales intactos.
- Conservar CreditAudit/TicketAudit como registros de dominio. Una operación de
  ajuste puede producir dos filas CreditAudit: referencias distintas por campo,
  ligadas al mismo request ID, sin violar `external_reference UNIQUE`.
- Usar actor ID estable en registros nuevos. No inferir actores de filas históricas
  ambiguas ni convertir usernames Builder en filas de usuarios Admin.

El recibo de una repetición contiene la instantánea original: no se presenta como
saldo actual. Refrescar el recurso antes de preparar una operación nueva.

## Serie de commits

Cada commit incorpora pruebas del comportamiento que introduce. Los cambios de
contrato actualizan sus consumidores en el mismo commit; el panel nunca queda
esperando una corrección posterior para poder enviar campos obligatorios.

### 1. `refactor(authz): define explicit administrative actions`

**Propósito:** distinguir facultades sin ampliar quién tiene acceso.

- Registrar este plan y el análisis con excepciones exactas en `.gitignore`.
- Introducir nombres inequívocos dentro de Permission y actualizar la matriz.
- Cambiar todas las comprobaciones administrativas a su acción correspondiente,
  incluidos los dos diagnósticos. Revisar aliases e imports antes de eliminarlos.
- Definir códigos/resultados comunes pequeños; evitar un segundo catálogo o
  una infraestructura de configuración dinámica.
- Conservar permisos Builder y la prohibición de actuar como propietario por ser Admin.

**Archivos:** permissions y sus tests, entradas administrativas, alias de permisos,
documentación. **Pruebas:** matriz Admin/Builder/anónimo, acciones desconocidas
rechazadas, coincidencia entre la acción declarada y cada entrada. No replicar
en tests la implementación completa de la tabla.

### 2. `feat(admin): persist operation receipts and resource revisions`

**Propósito:** soportar auditoría, repetición segura y detección de estado viejo.

- Añadir AdminActionLog, índices y revision; aumentar la versión del esquema.
- Incrementar revision en todas las escrituras runtime inventariadas de Credits.
- Actualizar contrato, preflight y diagnóstico del esquema.
- Implementar funciones de persistencia de recibos/eventos, sin modificar aún
  las reglas de negocio de las rutas.
- Preparar conversor offline v1 → v2 que produzca una copia nueva, rechace otros
  esquemas y no sobrescriba la fuente. Usar snapshot SQLite coherente, incluyendo
  WAL; no copiar únicamente el archivo principal de una BD activa.
- Ensayar conservación de datos e invariantes y restauración sobre bases temporales.

**Archivos:** database, schema-contract/preflight, diagnóstico, persistencia Admin,
core Credits, DTO de Credits, script de conversión y docs de operación.
**Pruebas:** esquema limpio, copia convertida, fuente intacta, conversión repetida,
esquema inesperado, índices de unicidad, rollback y revisión por cada clase de escritura.

### 3. `feat(credits): enforce contextual administrative adjustments`

**Propósito:** completar el primer recorrido desde formulario hasta BD.

- Implementar la entrada del módulo Admin con sesión actual, actor activo,
  revisión, motivo, regla aprobada de claim, transacción y recibo.
- Ajuste sobre cuenta de créditos inexistente devuelve 404; no éxito con balance 0.
- Adaptar PUT de créditos y el modal: motivo requerido, campos modificados,
  expectedRevision y request ID conservado para reintentos del mismo comando.
- Eliminar motivos automáticos y no reenviar un formulario viejo silenciosamente
  después de 409. Mostrar el conflicto y permitir recargar el estado.
- Mantener invariantes del core y auditar los deltas reales, no valores calculados
  antes de entrar en la transacción.

**Archivos:** módulo Admin, admin-auth/session helpers, credits/admin y core,
PUT de créditos, users-repository/DTO, builders.astro y script asociado.
**Pruebas:** matriz de regla claim, motivo vacío, revisión vieja incluso con
saldo que volvió al mismo número, sesión inactiva/caducada, error de BD,
fallo de auditoría que revierte escritura, replay después de perder respuesta.

### 4. `feat(credits): authorize and deduplicate administrative grants`

**Propósito:** compartir condiciones de asignación entre sus dos entradas.

- Hacer que POST users y PATCH credits llamen al mismo comando administrativo.
- Cantidad explícita y entera; no convertir una cantidad inválida en 100 créditos.
  Actualizar cualquier consumidor que dependiera de un valor por omisión.
- Conservar máximos actuales por entrada y techo del dominio; normalización de
  username y validación con utilidades existentes, sin exigir un nuevo RPC Hive.
- Rechazar asignaciones nuevas a bloqueados según la regla propuesta del plan.
- Registrar actor estable y referencia de operación; notificar tras commit.
- Integrar request ID en formulario de asignación y mantenerlo tras fallo de red.

**Archivos:** credits/admin, módulo Admin, ambas rutas, script de builders,
validadores compartidos acotados. **Pruebas:** ambos recorridos aplican política,
importe inválido nunca concede créditos, bloqueado/activo, mismo ID simultáneo,
ID con distinto contenido, fallo de notificación no revierte ni duplica créditos.

### 5. `feat(admin): audit contextual builder moderation`

**Propósito:** bloquear y reactivar como transiciones trazables.

- Unificar ambas rutas DELETE de bloqueo y la ruta de reactivación en el módulo.
- Exigir motivo, request ID y expectedModerationRevision; adaptar sus controles
  del panel en este commit usando los patrones existentes de formularios.
- Conservar estado actual en BlockedHiveAccounts y evento en AdminActionLog.
- Una solicitud nueva contra el mismo estado y revisión devuelve sin cambio;
  no reemplaza el autor/motivo del bloqueo original. Una revisión vieja da 409.
- Conservar el PATCH antiguo que devuelve 410; no reintroducir usuarios Builder
  persistidos ni habilitar acciones por identificar Admin con un username Hive.

**Archivos:** auth/blocked-hive-accounts, operaciones de moderación, tres rutas,
listado/DTO y formulario. **Pruebas:** bloquear → reactivar → bloquear conserva
historia; replay, no-op, conflicto entre operadores, ABA de moderación,
conservación de créditos/tickets y rechazo de sesión Builder.

### 6. `feat(admin): authorize ticket issuance and administrative reads`

**Propósito:** completar el catálogo de entradas administrativas.

- Llevar emisión de tickets de sistema al mismo recorrido transaccional con
  recibo; fijar financiación y issuer desde el servidor, conservando validadores.
- Misma solicitud devuelve el ticket creado; nueva solicitud con código ya usado
  devuelve conflicto. No interpretar coincidencia de código como prueba de replay.
- Actualizar formulario/script vouchers con request ID en el mismo commit.
- Aplicar acciones de lectura a listados, diagnósticos, cuentas, estadísticas y
  auditoría, incluyendo lectores SSR que acceden directamente a repositorios.
- Mantener lectura como lectura: no crear un recibo por cada consulta de tabla.

**Archivos:** módulo Admin, management/tickets, vouchers.astro/script, páginas
management, layout/guards y rutas diagnósticas. **Pruebas:** fondos de sistema,
issuer real, atomicidad ticket/auditorías, colisión vs replay, entrada falsa de
financiación, cobertura de lectura SSR/JSON y ningún permiso extra para Builder.

### 7. `feat(management): explain action restrictions and show admin history`

**Propósito:** hacer visibles las decisiones y sus consecuencias.

- Traducir códigos estables a copy concreto y consistente usando convenciones
  existentes; separar falta de permiso, conflicto, entrada inválida y fallo técnico.
- Mostrar motivo de restricciones y estado actual cuando sea útil. Un claim no
  deshabilita todo el editor: restringe reducir pendientes, no ajustar disponibles.
- Añadir historial administrativo paginado y filtrable a logs. Mostrar actor,
  acción, objetivo, motivo, cambios y resultado confirmado/sin cambio.
- No afirmar que los registros antiguos contienen actores o motivos que no existen.
- El estado que muestra el panel es orientativo; reevaluar siempre al ejecutar.
  Reutilizar lecturas existentes; no añadir un motor de políticas en el navegador.
- Aplicar interface-harness cuando se implemente este cambio visual y los ajustes
  de formularios de los commits anteriores, sin rediseñar toda la consola.

**Archivos:** management/builders y logs, scripts de management, lector de eventos,
copy/contratos compartidos. **Pruebas:** lecturas paginadas/autorizadas y filtros;
verificación con navegador de motivo obligatorio, error de conflicto, refresh,
doble clic/reintento y legibilidad del historial.

### 8. `test(admin): verify concurrency recovery and authorization coverage`

**Propósito:** probar los riesgos que atraviesan varios recorridos y cerrar docs.

- Pruebas con procesos separados contra SQLite temporal: ajuste vs claim, ajuste
  vs grant, bloqueo vs asignación y dos requests idénticos. El mutex local no
  cuenta como prueba de exclusión entre procesos.
- Verificar rollback en fallo de inserción de recibo o de auditoría de dominio;
  recrear una solicitud cuya primera respuesta se perdió tras commit.
- Revisar todas las entradas antiguas, helpers y reexports: ninguna mutación
  administrativa puede eludir el módulo mediante una ruta todavía disponible.
- Mantener pruebas de invariantes del core y de límites HTTP; eliminar solo tests
  que dupliquen detalles internos ya reemplazados, nunca cobertura útil de dominio.
- Actualizar auth-closure, documentación de BD y análisis con resultado real de
  cada check. Quitar aliases obsoletos únicamente tras verificar cero consumidores.

**Pruebas:** batería focalizada de concurrencia e integración, verificación general,
simulación y recorrido real del panel local con sesión Admin de prueba.

## Validación y entrega

Antes de implementar: guardar baseline de tipos/lint/tests y estado Git; separar
fallos preexistentes de regresiones. Usar pnpm por `pnpm-lock.yaml` y packageManager.

Por commit funcional: typecheck, ESLint de archivos tocados y tests que prueben el
comportamiento. Cambios de contratos incluyen todos sus consumidores y Astro check.
Durante la ejecución con typescript-senior, envolver verificaciones con su flujo
auto-feedback y registrar comandos/resultados reales; no afirmar checks anticipados.

Al cierre: `pnpm check`, `pnpm test`, `pnpm build`, `pnpm test:simulation` y
`git diff --check`. WAX self-test es una comprobación adicional sin broadcast si
el entorno la permite; no hace falta modificar ni emitir operaciones de Hive.
No repetir baterías ya verdes sin cambios o una incertidumbre nueva que lo justifique.

Toda batería que escriba usa DATABASE_URL explícita de una DB temporal, fijada
antes de importar database. Verificar que los subprocesses heredan ese destino.
No asumir que el env de Vitest aísla la BD: la configuración leída no fija esa URL.

Reportar por separado:

- Tipos/lint/tests de módulos y rutas, con comandos y conteos.
- Simulaciones directas y pruebas SQLite, incluidas las de procesos separados.
- Astro HTTP/navegador con sesión Admin real de prueba y capturas/evidencia.
- Ensayo de conversión y restore en copia.
- Despliegue, Turso y Hive externo: pendientes salvo ejecución explícita y evidencia.

## Conversión, despliegue y recuperación

Los commits son unidades de revisión, no ocho despliegues parciales. El commit 2
cambia el esquema esperado; las comprobaciones intermedias se hacen sobre DB
temporal nueva o convertida. No arrancar esa versión contra la BD de trabajo
esperando que db:init la actualice automáticamente.

Preparar versión completa y copia convertida, pausar escritores/reconciliadores,
validar backup, conservar balances/tickets/cuentas/intents/auditorías y cambiar
código+BD de forma coordinada. No usar db:reset. No aplicar conversión al destino
real durante esta tarea de diseño ni como efecto secundario de pruebas.

Si falla antes de nuevos efectos, restaurar el par compatible de código y backup.
Si hubo efectos externos de Hive o movimientos posteriores, revisar/reconciliar
antes de restaurar: un rollback de BD no deshace la cadena. Probar esta secuencia
en copia y registrar que el comportamiento remoto requiere evidencia propia.

## Revisión crítica del plan

Hallazgos de lectura estática; confianza MEDIUM, todavía sin tests ejecutados:

| Prioridad | Riesgo | Respuesta del diseño |
| --- | --- | --- |
| P1 | Ajuste viejo sobrescribe un claim o un grant que ya confirmó | Revisión incrementada por todos los escritores y comparación dentro de transacción |
| P1 | Retry tras perder la respuesta asigna créditos otra vez | Request ID + hash + recibo y mutación atómicos |
| P1 | Cambiar schema impide arrancar con la BD anterior | Versión explícita, conversión offline y corte coordinado; sin reset |
| P2 | Política solo en una ruta deja un acceso alternativo | Dos asignaciones, dos bloqueos, dos diagnósticos y lectores SSR inventariados |
| P2 | Nuevo body obligatorio rompe el panel durante varios commits | Consumidor y servidor cambian juntos en cada recorrido |
| P2 | El historial nuevo parece acreditar eventos anteriores | Inicio explícito de cobertura y ninguna reconstrucción inventada |

Prueba de eliminación aplicada al módulo propuesto: desaparecería un nombre y
parte del despacho, pero autenticación vigente, lectura actual, políticas,
repetición, transacción y auditoría reaparecerían en múltiples entradas. Su
interfaz oculta ese orden obligatorio y gana profundidad. Un evaluador genérico
expuesto dejaría ese conocimiento en cada llamador; se conserva como función
interna. SQLite real temporal permite probarlo sin agregar adaptadores remotos.

## Estado al terminar este diseño

Regla de claim confirmada por el usuario. Ocho commits descritos con propósito,
archivos, dependencias y pruebas. No se crearon commits ni se cambiaron código,
esquema o datos. El plan es local e ignorado por Git hasta que el primer commit
habilite las rutas exactas del plan y del análisis. La nota de sesión permanece local.
