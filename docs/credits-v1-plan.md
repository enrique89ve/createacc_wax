# Credits v1: plan de implementación por commits

Estado: planificación; implementación pendiente.
Base revisada: `d3fa976` (`main`), 2026-09-16.

## Objetivo y alcance

Cerrar Credits v1 con un claim persistente, verificable entre procesos y atómico:
una prueba válida mueve el importe autorizado una sola vez y genera su auditoría
en la misma transacción. El core mueve cantidades; los adapters verifican evidencia
externa; los servicios coordinan; los endpoints validan y traducen resultados HTTP.

Se mantienen congelados AUTH, Tickets y la relación Credits→Uses. Los cambios en
fixtures de Tickets por el renombre de una columna no cambian sus reglas. La
identidad continúa siendo `hive_username`, sin introducir usuarios Builder en
AUTH ni una relación con `user` para los intents.

Incluye asignaciones, ajustes administrativos existentes, claim, auditoría,
consistencia y terminología de Credits. Los módulos nuevos serán funciones y
contratos pequeños, siguiendo `typescript-pro`, sin clases, dependencias nuevas
ni directorios `ports/repositories/domain/infrastructure`.

Pagos HIVE/HBD, órdenes, pricing, treasury y un `purchase-service` quedan para una
segunda fase. No se crearán archivos vacíos ni endpoints de compra en esta fase.

## Hallazgos que cambian el plan original

- `claim-verify.ts` actualiza Credits directamente sin comprobar `rowsAffected`.
  Una verificación concurrente puede insertar auditoría sin mover saldo. Si una
  asignación nueva aumenta el pendiente, reutilizar el mismo intent también puede
  mover cantidades dos veces.
- `getCreditMapping()` elimina el mapping **antes** de la transacción. Conservar
  el hash hasta el commit no permite reintentar si el mapping ya desapareció.
- `withTransaction()` ya propaga la transacción mediante `AsyncLocalStorage` y
  une llamadas anidadas. Se reutiliza; dentro de ella debe usarse `execute()`,
  nunca `db.execute()` sobre el cliente compartido.
- `verifyClaimTransaction()` selecciona la primera operación con el ID esperado,
  no devuelve su índice y confía en datos RPC/JSON sin validación completa. Tiene
  además un cleanup sin consumidores que apunta a la tabla antigua `TempClaimHashes`.
- `adjustCredits()` lee el saldo y calcula diferencias fuera de la transacción.
  Debe corregirse al centralizar mutaciones para no auditar deltas obsoletos.
- `transferCredits()` solo tiene su definición y exportación: no hay consumidores
  en el repositorio. El tracker tampoco contabiliza sus movimientos.
- El frontend lee `available` y `pending` tras el claim; el endpoint devuelve
  `newBalance`. Este contrato se corregirá junto con la integración del claim.
- `initializeDatabase()` solo aplica `CREATE IF NOT EXISTS`; README prescribe
  esquema limpio después de cambios estructurales. No existe infraestructura de
  migraciones incrementales que este refactor deba ampliar.
- `total_assigned` aparece en tipos, dashboard, endpoints, seed, simulación y
  fixtures. El renombre debe abarcar todos esos lectores en un mismo commit.

## Contratos e invariantes

### Intent persistente

`CreditClaimIntents` contendrá únicamente:

| Campo           | Contrato                                                               |
| --------------- | ---------------------------------------------------------------------- |
| `hash`          | PK, NOT NULL, 32 bytes aleatorios representados como 64 caracteres hex |
| `hive_username` | Identidad normalizada, obtenida de la sesión                           |
| `amount`        | Entero seguro positivo; snapshot del pendiente al emitir el intent     |
| `created_at`    | Epoch en milisegundos                                                  |
| `expires_at`    | Epoch en milisegundos, `created_at + 10 minutos`                       |

Constraints SQL para importe entero positivo y expiración posterior a creación;
índice de expiración. Sin `creditId`, mapping, `Map`, cleanup por `setInterval` ni
foreign key hacia AUTH. La limpieza de expirados será oportunista al emitir un
intent; su presencia física nunca concede validez.

Emitir y leer el pendiente se hace transaccionalmente. Si no hay pendiente, no se
crea intent ni fila Credits. Emitir otro intent no invalida automáticamente uno
anterior: cada uno conserva su snapshot, pero todos compiten contra el pendiente
actual. Un aumento posterior no aumenta el importe ya autorizado. Una reducción
que lo haga insuficiente produce conflicto sin consumo ni auditoría.

### Adapter Hive

Archivo: `src/lib/credits/adapters/hive-claim-adapter.ts`.

Entrada: `transactionId`, `hash` y `username` esperado. Salida discriminada: prueba
válida o error tipado. La prueba contiene `username`, `hash`, `transactionId`,
`operationIndex` y `externalReference`. **El hash debe viajar en la prueba** para
vincularla inequívocamente al intent; el importe lo aporta la base de datos.

El adapter valida desde `unknown` la respuesta RPC y cada operación candidata:
ID de transacción devuelto, tipo `custom_json_operation`, ID `claim_credits`,
posting auth del usuario, JSON válido, `BRAND.CLAIM_APP_ID`, acción, hash, username
y timestamps válidos. Conserva el ID de aplicación ya publicado en cadena.
Recorre las operaciones hasta encontrar una coincidencia completa y conserva el
índice original, base cero, incluyendo operaciones de otros tipos.

Se mantiene la ventana actual de antigüedad de 30 minutos para la transacción.
Fechas inválidas no pasan mediante `NaN`; una fecha futura fuera de una tolerancia
explícita de reloj de 30 segundos se rechaza. El TTL del intent sigue siendo una
comprobación independiente y autoritativa en el servicio.

Un txid se valida y normaliza a hex minúscula antes de construir
`hive:claim:<txid>:<op_index>`. Un timeout/fallo del proveedor se distingue de una
prueba inválida. El adapter no importa base de datos, Credits Core ni pricing.
La extracción mantiene el proveedor WAX/HAF actual; los formatos exactos se
contrastarán con sus tipos instalados y fixtures al implementarla.

No se añade espera de irreversibilidad al claim en este refactor: el estado actual
solo exige inclusión observada. Esta limitación debe figurar en el cierre. La
irreversibilidad de pagos es requisito separado de la fase HIVE/HBD.

### Servicio y core

Archivo: `src/lib/credits/claim-service.ts`, con operaciones para emitir, consultar
y completar un intent. Primero se lee el intent del usuario; después se consulta
Hive, fuera de la transacción de escritura. Completar realiza:

```text
withTransaction
  DELETE CreditClaimIntents
    WHERE hash = ? AND hive_username = ? AND expires_at > ahora
    RETURNING amount
  exigir exactamente una fila
  core.claimCredits(username, amount, auditContext)
    UPDATE Credits: pending -= amount; available += amount
      WHERE hive_username = ? AND pending_amount >= amount
    exigir rowsAffected === 1
    INSERT CreditAudit con external_reference
  leer saldo resultante dentro de esta misma transacción
COMMIT
```

La comprobación final de expiración ocurre después de adquirir la transacción,
no usa un tiempo capturado antes de esperar su turno. Ante cualquier fallo, se
revierte el DELETE, el movimiento y la auditoría. El core recibe una referencia
externa opaca en el contexto de auditoría: no interpreta prefijos, txids ni RPC.

Los importes públicos del core se validan como enteros seguros y positivos;
los valores absolutos de ajustes admiten cero. También se evita desbordar el
rango de enteros seguros al sumar saldos o totales. Las firmas de las operaciones
Credits→Uses y su semántica se conservan.

### Deduplicación y HTTP

`CreditAudit.external_reference` será nullable y tendrá un índice UNIQUE parcial
para valores no nulos. Operaciones internas pueden seguir insertando NULL.
No se reconstruyen referencias históricas a partir de `reason`: un txid sin
índice no identifica de forma segura una operación.

La política v1 es **un único efecto**, con replay rechazado; no promete devolver
el éxito original en cada reintento:

| Situación                                       | Resultado                                   |
| ----------------------------------------------- | ------------------------------------------- |
| Primera aplicación correcta                     | 200, créditos movidos y saldo transaccional |
| Intent inexistente, ajeno o expirado            | 404, sin revelar datos de otro usuario      |
| Intent ya consumido en una carrera              | 404, sin segundo movimiento                 |
| Pendiente insuficiente o referencia ya aplicada | 409, rollback completo                      |
| Body mal formado o prueba inválida              | 400, sin consumir intent                    |
| Proveedor temporalmente no disponible           | 503, intent reintentable dentro del TTL     |
| Fallo interno de persistencia                   | 500, rollback completo                      |

Si se pierde la respuesta después del commit, consultar saldo/historial permite
confirmar el resultado; reenviar el intent no acredita otra vez. Una colisión de
referencia debe comprobarse como tal, sin convertir cualquier error SQL en replay.

Se conservan `/claim-hash` y `/claim-verify`, CSRF, sesión y permisos existentes.
`claim-hash` pasa a ser el controller de emisión persistente. Se elimina
`claimCode`, que no tiene consumidor, y se conservan `hash`, `customJson`,
`creditsAvailable`, `expiresAt`. La respuesta de verify conserva `credits`,
`transactionId`, `newBalance` y añade `available` y `pending` desde el mismo
resultado transaccional para el consumidor actual. Respuestas del claim: no-store.

### Asignaciones, ajustes y ledger

- `grantPendingCredits()`: aumenta pending y total emitido, audita `assign_credits`.
  `admin.assignCredits()` coordina esta operación y notifica tras el commit.
- `grantAvailableCredits()`: aumenta available y total emitido directamente;
  audita una operación nueva tipada `grant_available_credits`. Tendrá pruebas y
  soporte del tracker, pero no un endpoint público ni compra en esta fase.
- Los claims nuevos usan la operación canónica `claim_credits` y la referencia
  externa. El tracker sigue entendiendo `claim_via_blockchain` histórico.
- Los ajustes absolutos siguen siendo correcciones, no emisión. Lectura, delta,
  escritura, auditoría y saldo devuelto ocurren dentro de una transacción del core.
  El delta de available mantiene `admin_adjustment`; el de pending se registra
  separadamente como `admin_adjust_pending`. No se pierde el cambio de pending
  ni se mezcla con el saldo available. Un no-op no genera auditoría.
- Un ajuste no cambia `total_issued`: conserva la semántica actual del acumulado
  histórico de emisión. Por ello no se impone la igualdad ingenua
  `issued = pending + available + consumed`, que ignora Uses y correcciones.
- Tras el renombre, el tracker calcula emisión desde asignaciones más grants
  directos; available desde claims, grants directos, descuentos de tickets,
  refunds y ajustes de available. `consume_credits` no descuenta available otra vez.
- Eliminar la API de transferencias no borra eventos históricos. El diagnóstico
  contabilizará `transfer_in/out` antiguos sin permitir nuevas transferencias.

`shared.ts` mantiene el helper de auditoría, con operaciones tipadas y referencia
opcional. Los únicos llamadores que registran movimientos serán las operaciones
del core. Fixtures y seed no representan caminos de escritura del producto.

## Secuencia de commits

Cada commit incluye sus pruebas pertinentes y debe compilar por sí solo. No se
divide la sustitución de ambos endpoints y la retirada del cache en estados que
usen dos fuentes de autoridad diferentes.

| Orden / mensaje previsto                                                | Alcance concreto                                                                                                          | Criterio de salida                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0. `docs: plan credits v1 closure`                                      | Este plan y contexto local de sesión                                                                                      | Alcance, contratos, orden y límites verificables                                                                                                          |
| 1. `feat(credits): add persistent claim schema and audit references`    | `database.ts`, `types/database.ts`, tipos de auditoría, `credits/shared.ts` y lecturas de historial                       | Esquema limpio e init repetido; UNIQUE rechaza referencia repetida; admite múltiples NULL; importes de intent inválidos rechazados                        |
| 2. `refactor(credits): isolate hive claim verification`                 | Adapter nuevo, contratos y tests; `hive-transaction-verifier.ts` como fachada temporal para el endpoint existente         | Índice correcto entre múltiples operaciones; identidad, hash, app, posting auth, fechas y RPC inválidos rechazados; adapter sin DB                        |
| 3. `fix(credits): complete claims atomically from persistent intents`   | `claim-service.ts`, `core.claimCredits`, ambos endpoints, contrato del consumidor; borrar cache y fachada antigua         | Un ganador por intent; rollback conserva intent; UNIQUE revierte saldo; lectura de saldo en transacción; guards preservados; contrato HTTP probado        |
| 4. `refactor(credits): centralize grants and admin adjustments`         | `core.ts`, `admin.ts`, `shared.ts`, tipos, tracker, validación runtime de API admin, pruebas                              | Grants y ajustes solo mutan en core; lectura/delta bajo transacción; auditoría correcta en carreras; notificación posterior; grants directos consistentes |
| 5. `refactor(credits): remove unused builder transfers`                 | Eliminar función y export de `credits-service.ts`; soporte de lectura histórico en tracker                                | Sin consumidores ni API de transferencia; eventos antiguos siguen contabilizándose                                                                        |
| 6. `refactor(credits): rename total assigned to total issued`           | Esquema, tipos/guards, core/shared/tracker, dashboard, endpoints, fixtures, seed, simulación y docs vigentes              | Ningún lector/escritor activo usa el nombre anterior; contratos HTTP y agregados coherentes; suites congeladas siguen pasando                             |
| 7. `test(credits): verify cross-process claims and document v1 closure` | Pruebas entre procesos y regresión integral, `docs/credits-closure.md`, actualización de `docs/credit-balance-tracker.md` | Gates locales documentados; limitaciones de proveedor/despliegue separadas; sin declarar smoke real que no se haya ejecutado                              |

Dependencias: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. En cada paso se revisará el diff
antes de crear el commit. No se agruparán cambios ajenos en estos commits.

## Matriz de pruebas

1. **Persistencia:** emitir en proceso A y completar en B sobre el mismo archivo
   SQLite; reiniciar el emisor no invalida el intent; expirados no se consumen.
2. **Identidad:** hash de otro usuario, hash inexistente, proof con distinto hash,
   usuario o app; ninguna combinación produce saldo ni auditoría.
3. **Adapter:** operación válida en posición distinta de cero; una candidata
   previa inválida no oculta otra válida; payload escalar/null, auth ausente,
   timestamps inválidos/futuros/antiguos y error RPC fallan de forma tipada.
4. **Concurrencia:** mismo intent enviado dos veces, también con pendiente
   adicional suficiente para ocultar una doble acreditación; exactamente un
   ganador y una auditoría. Dos intents distintos contra pendiente insuficiente
   no sobreacreditan. Las pruebas entre procesos evitan que la cola JS local
   oculte una carrera de base de datos.
5. **Rollback y replay:** fallo de auditoría, saldo insuficiente y referencia
   repetida dejan intent/saldos/auditoría sin cambios parciales. Reintento válido
   después de un fallo transitorio funciona. Repetición tras éxito no acredita.
6. **Tiempo y snapshot:** expiración durante RPC o esperando transacción; nuevas
   asignaciones y reducciones administrativas después de emitir el intent.
7. **Administración:** grants positivos; cero/fracción/negativo/NaN/infinito y
   overflow rechazados; ajustes a cero permitidos; deltas actuales en carrera con
   claim; asignar a quien nunca inició sesión no crea usuario de AUTH.
8. **Ledger y regresión:** grant pending → claim → ticket → consumo/refund;
   grant available sin claim; correcciones de ambos saldos; transferencias
   históricas; sin doble descuento del consumo ni cambios en ownership de Tickets.
9. **Endpoints:** CSRF, sesión y RBAC conservados; body inválido; errores tipados;
   respuestas del claim compatibles con `creditos.astro`.

Los mocks se reservan al borde Hive y a fallos controlados. Atomicidad, UNIQUE,
rollback y persistencia deben probarse contra SQLite/libSQL real. Pruebas locales
entre procesos no equivalen a validación de una instalación remota de Turso.

## Validación y aplicación del esquema

- Línea base ejecutada antes de implementar: `pnpm test` sobre SQLite temporal,
  **22 archivos / 113 tests pasan**. `pnpm check`: Astro y TypeScript pasan
  (dos hints); ESLint falla con **4.368 errores y 1.154 warnings**, incluyendo
  `.summarize-tmp` y archivos de `src`. Son problemas previos al refactor.
  No se hará una limpieza masiva ajena a Credits en esta serie. Cada commit
  corregirá el lint de su alcance y comparará el resultado global con la base;
  un freeze que exija `pnpm verify` completamente verde queda pendiente hasta
  resolver también el baseline global. No se ocultarán errores con disables.
- Gestor detectado: `pnpm-lock.yaml`, `packageManager: pnpm@11.22.0`.
- El shell inicial resuelve pnpm de Windows y no encuentra Node en Linux. Para
  validar se antepone `/root/.nvm/versions/node/v24.19.0/bin` al PATH del proceso;
  así se usa Node Linux y pnpm 11.22.0, sin modificar configuración global.
- Por commit funcional: tests focalizados y `pnpm check`; al cierre:
  `pnpm verify` y `pnpm build`.
- Pruebas de persistencia/simulación usan una DB temporal explícita, sin credenciales
  ni sync de Turso heredados. No ejecutar `db:reset` sobre la DB de trabajo.
- `pnpm verify:simulation` añade WAX y simulación: su resultado se registra aparte
  por depender de servicios externos. Nunca se confunde con smoke de Keychain.
- Cambios de esquema siguen el modelo limpio del repo. `db:init` **no** convierte
  una DB antigua y no sirve como procedimiento de actualización de esos datos.
  Un despliegue que deba preservar datos necesita un procedimiento de migración
  explícito aparte; no se hará un reset destructivo como parte de esta serie.
- No pueden convivir instancias antiguas con cache y nuevas con intents DB durante
  el corte. Los hashes en memoria no son migrables: el despliegue debe drenar las
  instancias antiguas y permitir que el usuario genere un intent nuevo.
- El renombre de columna y campos HTTP exige desplegar código y esquema compatibles;
  los consumidores externos, si existen, deben contemplarse antes del despliegue.

## Criterio de freeze y fase posterior

Credits v1 queda cerrado localmente cuando pasan los checks, la matriz anterior y
la regresión de AUTH/Tickets; no quedan escrituras de cantidades en controllers o
admin, ni cache de claims, ni consumers del nombre anterior. El cierre registra
qué se probó, comandos, resultados y los límites de evidencia.

El smoke real de Builder + Keychain + proveedor Hive + despliegue sigue siendo
evidencia independiente. El freeze local no promete pagos listos ni prueba un
despliegue remoto.

Después: un único `hive-payment-adapter.ts` para HIVE/HBD verifica transferencia,
pagador, destino, asset, importe decimal exacto, memo/orden e irreversibilidad;
produce evidencia normalizada y `hive:payment:<txid>:<op_index>`. Una política de
pricing separada calcula créditos y un servicio de compra llama a
`grantAvailableCredits()`. No hay segundo claim. Antes de implementar esa fase se
definen treasury, órdenes, pricing y expiración; no se inventan ahora.
