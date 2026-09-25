# Autorización contextual de acciones administrativas

Fecha: 2026-09-25. Estado: análisis y propuesta, sin implementación.

Actualización posterior: el usuario aprobó proteger los pendientes contra reducciones
administrativas mientras exista un intent vigente. El diseño actualizado, con esta
decisión y ocho commits, está en `docs/admin-action-authorization-plan.md`.
Las decisiones abiertas que se describen abajo corresponden al análisis inicial.

## Recomendación

Mantener Admin y Builder como roles base y expresar cada operación mediante una
acción concreta, un recurso y sus hechos actuales. Implementar inicialmente las
políticas como funciones TypeScript dentro de HolaHive. El objetivo es explicar
por qué se permite una operación y asegurar sus condiciones al ejecutarla.

Esto combina permisos por rol con atributos y relaciones de propiedad. Los
invariantes contables y de creación siguen siendo obligatorios para cualquier
actor, incluido Admin. Una autorización nunca convierte evidencia ambigua de
Hive en evidencia de éxito o fracaso.

## Fuentes primarias consultadas

- [How Netflix Is Solving Authorization Across Their Cloud, KubeCon 2017](https://www.slideshare.net/slideshow/how-netflix-is-solving-authorization-across-their-cloud/84384095).
  Presentación publicada por Torin Sandall, coautor junto con Manish Mehta de
  Netflix. Las diapositivas 5, 13 y 16–20 presentan identidad, operación, recurso
  y decisiones basadas en datos. Es una referencia histórica de arquitectura;
  no acredita por sí sola el despliegue actual de Netflix.
- [Referencia oficial de OPA a la charla de Netflix](https://www.openpolicyagent.org/ecosystem/entry/custom-library-microservice-authorization).
  Distingue el cálculo de la decisión de su aplicación por una biblioteca o proxy.
- [Data Projects: Managing Data Assets at Netflix Scale, 11 de mayo de 2026](https://netflixtechblog.com/data-projects-managing-data-assets-at-netflix-scale-7ca25888591e).
  Describe permisos con alcance de proyecto e identidades duraderas para trabajos
  asíncronos. Para HolaHive es una referencia de alcance e identidad; no justifica
  agregar proyectos, organizaciones o nuevos roles sin un caso de uso.
- [OPA: Philosophy](https://www.openpolicyagent.org/docs/philosophy).
  Documenta decisiones con datos de contexto y separación entre política y ejecución.
- [OPA: Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs).
  Documenta identificación de decisiones, revisión de políticas y filtrado de datos
  sensibles. La adaptación a HolaHive que sigue es una propuesta propia.

## Situación actual comprobada en código

La lectura es estática. No se ejecutaron tests, servidor ni acciones administrativas.
Las prioridades siguientes son de diseño; no representan vulnerabilidades explotadas.
Confianza MEDIUM: evidencia de código local, sin comprobación de ejecución en esta sesión.

| Prioridad / confianza | Evidencia | Implicación |
| --- | --- | --- |
| P2 / MEDIUM | `src/lib/auth/permissions.ts:47`: `canPerform` solo combina sesión, rol y permiso. El parámetro `context` de `assertCanPerform` se usa para mensajes. | El autorizador no recibe recurso, importe, estado ni motivo. |
| P2 / MEDIUM | `src/lib/auth/permissions.ts:7`, `src/pages/api/management/users.ts` y `src/pages/api/management/users/[id]/reactivate.ts:18`. Asignación, listado, bloqueo y reactivación comparten `MANAGE_CREDITS`; `ASSIGN_CREDITS` es un alias. | No se pueden distinguir esas facultades cambiando la tabla de permisos. Todos siguen siendo Admin-only hoy. |
| P2 / MEDIUM | `src/pages/api/management/users/[username]/credits.ts:133` admite razón ausente o vacía y usa una frase genérica. `src/lib/credits/core.ts:249` consulta Credits y aplica el ajuste dentro de transacción, sin consultar intents. | La corrección tiene auditoría contable, pero no una política explícita respecto de reclamaciones pendientes ni justificación específica obligatoria. |
| P2 / MEDIUM | `src/lib/auth/blocked-hive-accounts.ts:51` elimina el bloqueo; `src/pages/api/management/users/[id]/reactivate.ts:32` pasa únicamente el username. | Ese recorrido no conserva un evento propio de reactivación con actor y motivo. El bloqueo repetido también reemplaza los datos de la fila anterior. |

Ya existe contexto fuera del autorizador: `src/pages/api/builders/tickets/[id].ts:60`
verifica financiación y propietario dentro de transacción. `src/pages/api/management/tickets.ts:108`
crea el ticket de sistema y su auditoría juntos, con `issuer_admin_id` y
`funding_source`. `src/lib/auth/admin-auth.ts` valida sesión, rol e inactividad.
No sería correcto afirmar que toda la aplicación solo comprueba el rol.

El test existente `src/lib/credits/claim-service.test.ts:162` describe la conservación
del intent cuando el saldo pendiente resulta insuficiente. Se leyó, no se ejecutó.
La interacción ajuste/claim requiere una política explícita; no demuestra pérdida
de créditos ni permite saltarse las reglas de finalidad Hive.

## Acciones y contexto propuestos

Nombres ilustrativos, todavía sin nuevos símbolos en producción.

| Acción | Datos de confianza necesarios | Decisión propuesta |
| --- | --- | --- |
| Asignar créditos | Admin actual, username normalizado, bloqueo del destinatario, importe y límites vigentes | Separar la facultad de asignar de la de moderar; decidir expresamente si se permite otorgar nuevos créditos a bloqueados. |
| Ajustar créditos | Admin actual, balances actuales, cambio solicitado, intent relevante y motivo | Exigir justificación y detectar conflicto con una reclamación. Diseñar la regla exacta antes de imponerla. |
| Bloquear usuario | Admin actual, username objetivo, estado y motivo | Registrar transición y autor; establecer semántica de bloqueo repetido. |
| Reactivar usuario | Admin actual, bloqueo existente y motivo | Registrar la reactivación conservando el historial; definir qué ocurre si ya estaba activo. |
| Emitir ticket de sistema | Admin actual, usos válidos, código, financiación de sistema e identidad del emisor | Conservar las restricciones actuales. Un presupuesto global solo sería posible con una fuente de verdad y una regla aprobadas. |
| Consultar diagnósticos | Admin actual y tipo de diagnóstico | Dar a la lectura una acción propia, separada de ajustar saldos. |

Una cuenta bloqueada puede requerir una corrección administrativa legítima. Por
eso, una regla universal «bloqueado implica negar cualquier operación» sería
demasiado amplia. El tratamiento debe depender de la acción.

## Forma del módulo

La interfaz actual exige que cada recorrido HTTP conozca autenticación,
permisos, lectura del recurso, condiciones, transacción y auditoría.

Hay dos alternativas locales:

1. Exponer solo un evaluador `decidir(actor, acción, recurso, contexto)` y dejar
   ejecución y transacciones en cada recorrido. Es pequeño y fácil de probar,
   pero cada llamador sigue siendo responsable de cargar datos actuales y de
   no olvidar aplicar la decisión.
2. Exponer operaciones administrativas tipadas que reciban actor autenticado y
   comando validado; internamente cargan hechos, evalúan reglas, ejecutan y
   auditan. El evaluador puro queda como detalle interno. Esta es la opción
   recomendada para mutaciones: concentra las condiciones y el orden correcto.

Aplicando la prueba de eliminación: si se elimina el segundo módulo, la lectura
actual, decisión, escritura y auditoría reaparecen dispersas en los llamadores.
Esa concentración de responsabilidad justifica el módulo. La política pura es
cómputo local; SQLite puede verificarse con una base temporal aislada. No hace
falta una interfaz remota ni un adaptador OPA hipotético.

El catálogo debe distinguir acciones y parámetros con uniones discriminadas,
validar entrada `unknown` y rechazar acciones o hechos requeridos desconocidos.
El actor procede de la sesión del servidor; propietario, bloqueo y saldos
proceden de las fuentes de confianza del servidor. Nunca se aceptan como hechos
de autorización enviados por el navegador.

Flujo de una mutación:

```text
Autenticar y validar solicitud
  → abrir transacción
  → leer hechos actuales
  → comprobar facultad + condiciones de la acción
  → escribir con invariantes y protección frente a concurrencia
  → registrar cambio y decisión
  → confirmar
```

Una previsualización en el panel puede mostrar acciones disponibles y motivos,
pero la ejecución reevalúa la política. Una transacción protege la operación;
un valor absoluto calculado desde una pantalla vieja también necesita control
de versión/valor esperado si el contrato pretende conservar cambios intermedios.

La decisión debe distinguir permitido, prohibido y conflicto de estado, con
código estable y versión de política. No todos los fallos son HTTP 403: una
sesión ausente, entrada inválida, conflicto y fallo de infraestructura requieren
tratamiento propio. El texto visible puede traducirse desde esos códigos.

Auditar actor, acción, recurso, motivo, decisión, cambios antes/después, referencia
de operación y versión de política. La auditoría de una mutación confirmada debe
ser atómica con ella. Las denegaciones requieren un registro separado que no
desaparezca al revertir la transacción. Registrar solo datos necesarios, sin
cookies, contraseñas ni claves. Una decisión permitida no acredita por sí sola
que la ejecución haya terminado.

## Alcance inicial sugerido y condiciones pendientes

El candidato inicial es ajuste de créditos: tiene estado, efecto contable,
motivo y concurrencia, y permite demostrar el valor de la política contextual.
La propuesta requiere decidir qué ajustes son válidos durante un claim; no se
propone cancelar intents ni forzar reclamaciones. Después puede aplicarse el
mismo criterio a moderación y emisión de tickets.

Límites nuevos, reautenticación reciente y doble aprobación son decisiones de
producto por acción. No se inventan umbrales ni nuevos roles en este análisis.
La identidad Admin de Better Auth y la identidad Hive de Builder conservan sus
contratos distintos; el rol Admin no implica propiedad de tickets Builder.

OPA/Rego es una alternativa para cuando varios procesos o productos necesiten
compartir políticas y distribuirlas independientemente. Hoy añade operación,
distribución y sincronización de datos a una aplicación que puede evaluar sus
reglas en el mismo proceso. Adoptar la idea de Netflix no exige copiar su escala.

Verificación necesaria para una implementación: mismo rol con distintos estados;
actor sin facultad; datos de autorización falsificados en el cuerpo; ajuste que
compite con claim; dos ajustes desde el mismo estado; rollback de cambio y
auditoría; repetición idempotente; reactivación trazable; fallo de lectura sin
permiso por defecto. Ejecutar sobre DB temporal, conservando la DB de trabajo.

## Evidencia y límites

Revisión de fuentes primarias y lectura del código y tests existentes. No se
cambió código de aplicación, dependencias, esquema ni datos. No hay evidencia
nueva de tests, navegador, Turso, despliegue o broadcast Hive. Este documento es
local: la configuración actual de `.gitignore` excluye documentos nuevos en `docs/`.
