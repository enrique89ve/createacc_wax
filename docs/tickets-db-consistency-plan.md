# Tickets, DB y orquestación: plan de corrección

Estado: propuesto, pendiente de implementación.
Base revisada: `0bf79cc`, 2026-09-24.

## Objetivo y alcance

Cerrar los fallos de propiedad, financiación, borrado, compensación, finalización,
diagnóstico y coordinación encontrados en la auditoría. Conservar creación gratuita
desde Admin, financiación Credits → Uses desde Builder, simulación y creación real.

SQLite local es el modo predeterminado y una configuración completa de producción.
Turso online y las réplicas embebidas son opcionales: no se requieren credenciales,
conectividad ni recursos Turso para implementar, probar o desplegar el modo local.
La conexión a Hive para creación real es independiente del proveedor de base de datos.

La serie modifica contratos, esquema, servicios, endpoints, consultas y sus
consumidores necesarios. No rediseña login, permisos generales, claims de Credits,
pricing ni la interfaz visual. AUTH solo entra en el inventario de conexiones y
contención DB; sus reglas de autenticación permanecen fuera del refactor.

Se aplica `typescript-pro`: contratos discriminados, validación desde `unknown`,
funciones pequeñas para servicios nuevos y coherencia con los repositorios existentes.
No se reescriben clases existentes por estilo ni se agregan dependencias sin necesidad.

## Decisiones de diseño propuestas

### 1. Propiedad y financiación explícitas

- Ticket Builder: `funding_source = builder_credits`, `owner_builder_username`
  obligatorio e `issuer_admin_id` nulo. Solo ese Builder puede modificarlo.
- Ticket Admin: `funding_source = system`, `issuer_admin_id` obligatorio y
  `owner_builder_username` nulo. No pertenece a una cuenta Hive con el mismo nombre.
- `creator_username` puede conservarse como snapshot de presentación/auditoría;
  deja de autorizar acciones, determinar financiación o inferir roles mediante JOIN.
- CHECK SQL exige la combinación válida de campos. Propiedad y financiación son
  inmutables después de crear el ticket. No se añade transferencia de propiedad.
- Solo usos financiados por Builder producen reembolsos Builder. Consumo de tickets
  del sistema no toca `Credits` ni crea auditoría falsa de consumo Builder.
- `Accounts.builder_username` admite NULL para cuentas financiadas por el sistema;
  `ticket_id` conserva su procedencia. Actualizar parsers, estadísticas y exportaciones.
- `kind` y ciclo de vida del ticket siguen derivados. `funding_source` es un hecho
  económico independiente de su cantidad de usos o estado.

### 2. Identidad estable y archivado

- Mantener `Tickets.id` como identidad. `CreationAttempts`, `Accounts` y eventos
  relacionados referencian `ticket_id`; el código queda como identificador público
  inmutable y snapshot legible, sin ser la clave para resolver relaciones históricas.
- Persistir en el intento la financiación y propietario originales; comprobar su
  correspondencia con el ticket al reservar y cerrar. Nunca inferirlos del código actual.
- `DELETE /api/builders/tickets/:id` pasa a archivar. No hay borrado físico ni
  reutilización de códigos, incluso después de archivar. Mantener UNIQUE(code).
- Si hay intentos abiertos, devolver 409 sin reembolso ni archivado. Revocar puede
  impedir reservas nuevas mientras se resuelven las existentes; no cancela un broadcast.
- Archivado sin intentos abiertos: devolver exactamente los usos disponibles
  financiados por Builder, establecer `archived_at`, mover `remaining_uses` a
  `retired_uses` y dejar disponibles en cero, todo en una transacción auditada.
- `retired_uses` representa usos retirados por archivado; no cuentas creadas. Evita
  que poner remaining en cero haga aparecer los reembolsos como consumos. Los ajustes
  anteriores por delta siguen modificando total y remaining como hoy.
- Repetir DELETE del mismo ticket propio devuelve el resultado persistido, sin otro
  reembolso. No se permite restaurar un ticket archivado; revocación sigue reversible.
- Listados activos excluyen archivados; consultas históricas los conservan. Ajustar
  únicamente copy y contratos necesarios para mostrar archivado, reserva y consumo.

### 3. Cierre y compensación como transiciones atómicas excluyentes

Crear un servicio de ciclo de creación que usen HTTP, recuperación automática y CLI.
La entrada principal de cierre/compensación es el ID del intento, no parámetros
independientes que permitan elegir otro ticket o usuario.

| Operación               | Precondición comprobada dentro de la transacción                                                | Efectos indivisibles                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Reservar                | Ticket disponible, propietario habilitado, saldo de usos positivo, username sin intento abierto | Descontar un uso + insertar intento con identidad/snapshot                                                |
| Preparar                | Intento reservado y versión vigente                                                             | Guardar txid, expiración real y evidencia WAX pública; avanzar versión                                    |
| Autorizar broadcast     | Intento preparado, versión vigente y lease propio cuando aplique                                | Persistir broadcasting antes de enviar a Hive                                                             |
| Completar               | Identidad/evidencia válidas; intento abierto y versión vigente                                  | Transición condicional + Accounts único por intento/username + consumo Builder si corresponde + auditoría |
| Compensar               | Intento abierto, versión vigente y motivo que autorice devolver                                 | Transición condicional + restituir exactamente un uso al ticket original + auditoría                      |
| Repetir cierre terminal | Misma identidad y mismo resultado terminal                                                      | Leer resultado original, cero movimientos                                                                 |

Todo UPDATE esperado debe afectar exactamente una fila. Una discrepancia o fallo
de auditoría aborta la transacción mediante error tipado. La traducción a Result/HTTP
se hace fuera de ella: devolver un objeto de error no es un mecanismo de rollback.
No cambiar globalmente withTransaction para adivinar si un retorno significa error.

`completed` y `rolled_back` son terminales. Eliminar actualizaciones incondicionales
como markAttemptRecoveredOnChain. Una respuesta tardía tras rolled_back no crea una
cuenta ni altera créditos automáticamente: registra una incidencia para revisión.
Un caso histórico con Hive confirmado y uso ya devuelto necesita reparación explícita,
no una transición silenciosa que esconda un doble gasto.

La simulación conserva su comportamiento económico actual, pero jamás dispara
broadcast o delegación real. `completed` significa cierre local de la operación;
no equivale por sí solo a irreversibilidad de Hive. Los estados de cuenta siguen
distinguiendo simulated, broadcasted y confirmed.

### 4. Evidencia externa y coordinación persistente

- Añadir `version` al intento y lease con token único, vencimiento y generación.
  HTTP y workers compiten por la misma fila. Cada actualización verifica versión,
  token y estado; una lectura antigua no concede derecho a compensar.
- Nunca mantener una transacción DB abierta durante RPC, firma, espera o broadcast.
  La secuencia es reclamar → consultar/actuar → revalidar y cerrar en transacción.
- Un lease vencido permite transferir trabajo; no demuestra fallo del broadcast.
  Un worker antiguo no puede finalizar el trabajo de una nueva generación.
  El lease no puede revocar una petición de red ya autorizada: el recuperador observa
  el mismo txid y no construye otra transacción para reemplazarla. La exclusión SQL
  protege las decisiones locales; no se promete exactly-once sobre la red.
- Antes de transmitir, persistir txid y expiración obtenidos de la transacción real.
  Un error de persistencia impide transmitir. No guardar claves privadas.
- Reservas que nunca entraron en broadcasting pueden compensarse tras comprobar
  atómicamente estado, versión y abandono. Si otro proceso ya avanzó, la compensación
  pierde la carrera y no mueve usos.
- Tras un intento de broadcast, timeout, cuenta no encontrada o respuesta RPC
  incompleta se consideran incertidumbre. Conservar la reserva y reintentar consulta.
- Implementar un evaluador de evidencia de creación separado del adapter de claims:
  identidad de operación/cuenta, claves esperadas, txid, expiración y estado de cadena.
  No reutilizar reglas de elegibilidad de un claim como prueba de fracaso de creación.
- La compensación automática post-broadcast solo se habilita con evidencia de no
  ejecución definitiva validada contra el contrato real del proveedor y sus pruebas.
  Si el proveedor no permite demostrarla, pasar a revisión manual conservando el uso;
  no liberar por antigüedad ni por agotar reintentos. El CLI debe soportar resolución
  explícita con evidencia y auditoría, nunca una devolución forzada sin verificación.
- Matching de claves actuales no sustituye prueba histórica cuando hay evidencia de
  que la creación sí se incluyó: una cuenta puede cambiar autoridades. Una cuenta
  ajena solo autoriza devolver con evidencia suficiente de que este intento no creó.
- Distinguir explícitamente observación de cuenta, aceptación de broadcast y finalidad.
  La documentación de Hive diferencia estados transitorios/finales; un nombre de
  estado que contiene expired no basta para decidir devolver. Véase la
  [referencia oficial de Transaction Status](https://developers.hive.io/apidefinitions/#transaction_status_api.find_transaction).

### 5. Un único motor de reconciliación

- Extraer motor compartido de auto-reconciler, confirm-broadcasted y reconcile-pending.
  El timer y el CLI invocan el mismo flujo; el CLI dry-run no reclama ni modifica filas.
- ReconciliationQueue identifica trabajo por intento, con unicidad y programación
  persistente `next_attempt_at`. Reclamos/cierres requieren token de lease, no solo
  status=processing. Evitar duplicados y actualizaciones de workers obsoletos.
- El barrido de intentos huérfanos incorpora trabajo al mismo motor; deja de compensar
  directamente con snapshots antiguos. Se ejecuta incluso si el enqueue inicial falló.
- Backoff acotado, procesamiento por lotes y orden justo. Presupuesto de tiempo por
  fase; errores por entrada/fase no cancelan el resto del ciclo.
- Agotar reintentos significa requiere revisión, no resuelto. Mantener esa diferencia
  en status, flags, consultas, métricas y herramientas operativas.
- Inicio/parada explícitos del scheduler, ejecución inicial y cierre limpio. No depender
  de imports laterales de endpoints. El lock en memoria solo evita trabajo redundante;
  la exclusión entre procesos reside en DB.
- RC conserva su proceso separado del consumo. En su coordinación, un worker antiguo
  no marca el resultado de uno nuevo y processing expirado pasa a uncertain antes de
  decidir reintentar. No transformar un lease vencido en un segundo broadcast ciego.
- Métricas: reclamados, completados, compensados, pendientes por evidencia, fallidos,
  revisión manual, antigüedad máxima y último ciclo exitoso. Contar resultados reales.

### 6. Contrato de acceso y sincronización DB

- Mantener transacciones dedicadas y AsyncLocalStorage. Añadir una vía explícita para
  escrituras aisladas y snapshots de lectura, sin clasificar SQL mediante regex.
- Inventariar todos los writes: tickets, créditos, intentos, cola, RC, notificaciones,
  bloqueos y autenticación. Los controlados por la aplicación participan en el executor
  contextual y la cola local. No envolver ciegamente el adapter de Better Auth en una
  transacción ajena; probar su contención con las operaciones de negocio.
- Reintento acotado para bloqueo transitorio DB solo sobre operaciones DB seguras,
  después de rollback comprobado. No reejecutar broadcast, firma o callbacks con I/O
  externo. Un commit de resultado incierto se resuelve por identidad/idempotencia.
- Verificar constraints y activación efectiva de foreign keys por conexión/motor;
  usar RESTRICT para relaciones históricas. Probarlo, no asumirlo por declarar REFERENCES.
- SQLite local: un archivo compartido real y persistente; mutex local no promete
  exclusión entre procesos. Probar dos procesos y contención con escrituras externas.
  La propia base local es autoritativa y no necesita sincronización con Turso.
- Turso remoto, solo si se configura: escrituras y decisiones autoritativas mediante transacciones remotas;
  comprobar pérdida de conexión, retry y restricciones en una DB desechable remota.
- Embedded replica, solo si se configura: sync inicial, intervalo explícito, estado de sincronización y
  límites de antigüedad. Las decisiones de propiedad, bloqueo, saldo y reserva usan
  el primario autoritativo; las lecturas de réplica son para vistas que toleran retraso.
  En este modo, no permitir consumo/crédito desconectado de su primario ni creer que
  sync periódico evita carreras. Esa restricción no aplica a SQLite local autónomo.
- Documentar cada modo y rechazar combinaciones incompletas únicamente cuando se
  haya elegido un modo remoto. Sin configuración Turso, iniciar SQLite local sin
  conexiones remotas, tareas de sync ni advertencias por credenciales ausentes.
  La versión instalada
  de @libsql/client ya expone syncInterval; la
  [referencia oficial del cliente](https://tursodatabase.github.io/libsql-client-ts/)
  muestra su configuración. Validar implementación contra la versión del lockfile,
  sin actualizar dependencias como parte de esta corrección.

### 7. HTTP, auditoría y diagnóstico

Controllers finos: sesión/origen → parseo unknown → servicio transaccional → respuesta.
Mantener las rutas actuales y actualizar juntos sus consumidores cuando cambie el
contrato. IDs e importes deben ser enteros seguros; JSON null, arrays y cuerpos
malformados se rechazan. Las comprobaciones de disponibilidad previas son orientativas.

| Situación                                                                       | Contrato previsto                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| JSON/ID/campos inválidos                                                        | 400                                                                                    |
| Sin sesión / permiso denegado                                                   | 401 / 403                                                                              |
| Ticket inexistente o ajeno                                                      | 404 uniforme en operaciones por ID                                                     |
| Código ocupado, saldo insuficiente, archivado con reservas, estado incompatible | 409                                                                                    |
| Creación persistida que sigue pendiente de evidencia                            | 202 con correlationId y estado; cliente conserva claves y permite consultar/reintentar |
| DB/proveedor temporalmente indisponible sin resultado aceptado                  | 503                                                                                    |
| Fallo interno inesperado                                                        | 500 sin SQL ni secretos en respuesta                                                   |

La repetición de /create/account verifica identidad de sesión, intento, ticket y
claves públicas antes de responder éxito persistido; no basta que exista el username.
No permitir que un 202 borre material local necesario para recuperar la operación.

TicketAudit cubre creación, ajuste, revocación/restauración y archivado. Cada evento
incluye ticket_id, actor discriminado, delta/antes/después pertinente y referencia de
operación. CreditAudit registra dinero; eventos de intento registran reserva/cierre/
compensación. Todos los eventos necesarios se confirman con la mutación correspondiente.
Referencias únicas por efecto terminal evitan doble consumo y doble devolución.
Mantener lectura de operaciones históricas y exportación de tickets archivados.

Diagnóstico sobre un snapshot coherente:

1. Saldos vs ledger, incluyendo ajustes administrativos y transferencias históricas.
2. Por ticket: `total_uses = remaining_uses + reservas_abiertas + consumos_cerrados + retired_uses`.
3. Por intento: completed tiene exactamente una cuenta y su evento terminal;
   rolled_back no tiene consumo ni cuenta atribuida a ese intento.
4. Por Builder: consumo acumulado coincide con cuentas financiadas por él, incluyendo
   simulaciones según la política actual; tickets del sistema quedan fuera de Credits.
5. Reembolsos corresponden a usos financiados y a una operación única; no basta que
   exista una fila positiva en CreditAudit.
6. Conservación global con saldo pendiente/disponible, usos disponibles, reservas y
   consumo, incorporando ajustes explícitos. No usar issued=available+consumed.

Las discrepancias devuelven código, entidad y referencia concreta. El diagnóstico
no repara saldos automáticamente. Derivar reserved_uses y consumed_uses de intentos/
cuentas; no convertir todo uso no disponible en una cuenta creada.

## Secuencia de commits

Cada commit incluye regresiones pertinentes, compila y conserva lectores/escritores
coherentes. La serie se integra completa antes de desplegar. No dejar tests fallando
en un commit independiente ni dividir cambios de contrato inseparables.

| Orden y mensaje propuesto                                                  | Alcance principal                                                             | Criterio de salida                                                                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0. docs: plan ticket and database consistency closure                      | Este documento                                                                | Decisiones, cobertura y aplicación explícitas                                                    |
| 1. fix(tickets): separate system issuance from builder ownership           | Esquema de origen, contratos, endpoints, consultas y consumo por financiación | Colisión Admin/Hive no permite ver, mutar ni reembolsar tickets ajenos                           |
| 2. fix(tickets): preserve identity and archive refunded tickets            | ticket_id, snapshots, archived_at/retired_uses, DELETE y consumidores         | Borrado con reserva devuelve 409; archivado/replay devuelve una sola vez; código no reutilizable |
| 3. fix(creation): make completion and compensation mutually exclusive      | Servicio común de transiciones, filas afectadas, referencias terminales       | Fallos parciales revierten todo; cierre vs rollback tiene un único ganador                       |
| 4. fix(creation): fence recovery with persistent ownership and evidence    | Versiones, leases, snapshot de txid/expiración, evaluador Hive y handler HTTP | Worker obsoleto no autoriza otro broadcast ni cierra; incertidumbre conserva reserva             |
| 5. refactor(reconciliation): share durable recovery across workers and CLI | Motor, cola única, backoff, scheduler y coordinación RC                       | HTTP, dos workers y CLI convergen; errores de una fase no bloquean otras                         |
| 6. fix(database): coordinate writes and authoritative reads                | Executor, snapshots y contención local; modos remotos opcionales              | SQLite autónomo entre procesos; verificar primario/réplica solo si se activa ese modo            |
| 7. fix(api): validate ticket contracts and persist lifecycle audit         | Validación runtime, HTTP, auditoría completa, exportación, consumidor de 202  | Matriz HTTP y eventos exactos, sin errores SQL expuestos                                         |
| 8. feat(diagnostics): reconcile credits tickets attempts and accounts      | Tracker y diagnose con snapshot e invariantes                                 | Los fallos reproducidos dejan de ser declarados consistentes                                     |
| 9. test: validate ticket lifecycle across processes and failures           | Pruebas integradas, crash/restart y contratos completos                       | Todos los escenarios de aceptación pasan con DB real temporal                                    |
| 10. docs(database): define verified schema cutover and operating checks    | Preflight de esquema/datos, procedimiento, README y evidencia                 | Aplicación preparada sin pérdida implícita de datos; límites remotos explícitos                  |

Dependencia principal: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10.
Las pruebas comienzan en cada corrección; el paso 9 integra escenarios transversales.
Si un commit necesita un helper DB previo, mover solo ese prerrequisito antes del
consumidor manteniendo la intención del commit y documentándolo.

## Matriz mínima de aceptación

| Área                | Pruebas obligatorias                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Propiedad           | Admin y Builder con mismo nombre; dueño distinto; sistema sin fila Credits; bloqueado antes de reserva                                     |
| Creación de tickets | Código concurrente, saldo exacto, doble solicitud, fallo de auditoría; ticket/descuento indivisibles                                       |
| Usos                | Dos reservas del último uso; PATCH vs reserva; reducción vs consumo; fallo de insert del intento revierte descuento                        |
| Archivado           | Reserva abierta, cuenta ya cerrada, ticket nunca usado, repetición DELETE, revocado, código histórico duplicado                            |
| Terminales          | complete/complete, rollback/rollback, complete/rollback en ambos órdenes; identidad incorrecta; fallo en cada escritura                    |
| Hive                | Error antes de broadcast, timeout después de envío, RPC atrasado, cuenta ajena, claves cambiadas, evidencia insuficiente, resultado tardío |
| Procesos            | Proceso A cae tras reserva/preparación/broadcast/commit; B recupera; lease vence; A vuelve y no modifica trabajo de B                      |
| Cola y RC           | Enqueue fallido recuperado por barrido, duplicados, backoff/review, fase fallida aislada, RC uncertain sin reenvío ciego                   |
| Lecturas            | Saldo/auditoría en snapshot, colisión de nombres y cierre tardío detectados, historiales tras archivado                                    |
| HTTP                | Auth/CSRF, JSON escalar/null/array, ID decimal/negativo/infinito, 409 en carreras, 202 recuperable, replay tras respuesta perdida          |
| Modos DB            | SQLite entre procesos y arranque sin variables Turso obligatorios; pruebas remotas/réplica solo para el modo opcional elegido              |
| Simulación          | Mismos invariantes contables; cero broadcasts/delegaciones reales                                                                          |

Mocks solo en borde Hive y fallos controlados. Usar SQLite/libSQL real para atomicidad,
constraints, rollback y concurrencia. Barreras deterministas para carreras, no sleeps
arbitrarios. Los tests entre procesos deben evitar que el mutex JS oculte el problema.

## Aplicación de esquema y datos existentes

El repo actualmente prescribe esquema limpio y no tiene migraciones incrementales.
Se mantiene initializeDatabase sin migraciones implícitas. Los nuevos esquemas se
desarrollan y prueban exclusivamente sobre bases temporales.

Antes de aplicar a una instalación existente:

1. Preflight de versión/esquema, modo DB, reservas abiertas y consistencia; producir
   informe sin modificar datos. La app debe rechazar escrituras sobre esquema incompatible.
2. Preparar parada coordinada de emisores/workers y respaldo consistente verificable.
   No ejecutar db:reset sobre la base del usuario como parte de pruebas.
3. Si se conservan datos: conversión offline específica en una copia, nunca en runtime.
   Reconstruir origen solo con evidencia inequívoca de emisión/descuento/auditoría.
   Coincidencia de nombres o textos libres no es prueba suficiente. Ambigüedades,
   referencias perdidas y operaciones abiertas bloquean el cutover hasta resolverse.
4. Verificar cuentas, tickets, saldos y auditoría antes/después; ensayo de restauración.
   No crear créditos compensatorios ni atribuir cuentas para hacer pasar el diagnóstico.
5. Si se decide un inicio limpio, que sea una decisión explícita de despliegue con
   archivo del historial; el plan no presupone autorización para borrar datos.
6. Aplicar versión completa y verificar ciclo funcional. No volver al binario anterior
   contra esquema nuevo. Tras broadcasts reales, un restore de backup no revierte Hive:
   reconciliar esos efectos antes de cualquier rollback operativo.

La definición de este procedimiento no ejecuta un despliegue ni modifica la DB actual.

## Checks y definición de terminado

- Base de auditoría previa: 32 archivos / 156 tests pasan; reproducciones adversas
  adicionales expusieron los fallos descritos. Volver a medir baseline al implementar.
- Cada commit: tests relevantes y checks de tipos/lint de su alcance; diff revisado.
- Cierre: pnpm test con DATABASE_URL temporal y variables Turso eliminadas; pnpm check;
  pnpm build; git diff --check; simulación de integración sobre otra base desechable.
- Si check global falla por problemas anteriores, informar baseline/delta y resolver
  todos los nuevos; no presentar el gate global como aprobado ni ampliar a limpieza ajena.
- Separar resultado local, prueba entre procesos, prueba remota y smoke con Hive.
  Una prueba local nunca certifica Turso, propagación real ni despliegue.
- Terminado local: cada hallazgo tiene regresión, todos los escenarios locales pasan,
  consumidores actualizados y runbook de recuperación verificable. La falta de recursos
  Turso no bloquea este cierre ni el despliegue con SQLite local.
- Terminado operativo: modo real de DB validado, cutover aplicado conscientemente y
  evidencias del flujo desplegado. Para SQLite local, las pruebas Turso se marcan
  no aplicables, no pendientes. Solo si se elige Turso/remoto o réplica se exige su
  validación específica antes de declarar listo ese modo.

Este turno crea el plan; no implementa correcciones ni crea commits de código.
