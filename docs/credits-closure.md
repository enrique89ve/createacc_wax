# Credits v1: cierre local

Estado: implementado en catorce commits sobre `main`.

La serie dejó el claim en un flujo persistente, consciente de la finalidad Hive y atómico: el intent se guarda en
`CreditClaimIntents`, Hive produce evidencia normalizada con índice de operación,
y una única transacción elimina el intent solo después de una confirmación
irreversible, mueve `pending_amount` a
`available_amount` e inserta `CreditAudit.external_reference`. El `Map` y el
mapping opaco en memoria fueron eliminados. Los grants y ajustes administrativos
escriben mediante Credits Core. `total_assigned` se llama ahora `total_issued` en
el esquema y en los contratos activos. `transferCredits()` ya no se exporta;
eventos históricos `transfer_in/out` siguen incluidos en el diagnóstico. La
respuesta `pending` usa HTTP 202 y conserva el intent para reintentar; el cliente
espera un segundo tras el broadcast y después hace polling acotado.

Commits aplicados:

- `bf9fc53` `docs: plan credits v1 closure`
- `fbc59fa` `feat(credits): add persistent claim schema and audit references`
- `cc6a075` `refactor(credits): isolate hive claim verification`
- `f56620a` `fix(credits): complete claims atomically from persistent intents`
- `493b938` `refactor(credits): centralize grants and admin adjustments`
- `3e6ff5b` `refactor(credits): remove unused builder transfers`
- `c8dbeda` `refactor(credits): rename total assigned to total issued`
- `b69ce92` `test(credits): verify cross-process claims and document v1 closure`
- `fbb569d` `fix(credits): model Hive finality and propagation grace`
- `238b244` `test(credits): cover reversible-to-irreversible claim flow`
- `ad7f80b` `refactor(credits): unify balance consistency calculation`
- `b182834` `refactor(credits): make claim payload timestamp backward-compatible`
- `9d2e8a8` `docs(credits): close finality and consistency phase`
- `HEAD` `fix(credits): preserve irreversible expired claims`

Validación local ejecutada el 2026-09-17 con Node Linux 22.17.0 y pnpm 11.22.0,
usando una DB SQLite temporal y sin credenciales de Turso:

```text
pnpm test                         30 files / 142 tests passed
pnpm exec tsc --noEmit            passed
pnpm build                        passed
pnpm exec vitest run ...          adapter, polling, finality, schema, claim, core, stateless passed
```

La prueba `claim-process.test.ts` lanza procesos Node separados: un proceso
completa un intent emitido por el proceso de Vitest y un segundo replay recibe
`intent_not_found`; el saldo termina con un único movimiento. La concurrencia
en el mismo proceso también está cubierta: dos completions del mismo intent
producen un solo ganador.

La línea base anterior a la implementación tenía Astro y TypeScript sin errores,
pero ESLint fallaba con 4.368 errores y 1.154 warnings, incluidos archivos de
`.summarize-tmp` y problemas preexistentes de `src`. No se hizo una limpieza
masiva ajena a Credits ni se ocultaron reglas. Por ello `pnpm check` y `pnpm
verify` no se declaran verdes globalmente hasta resolver ese baseline. Tras esta
serie, el chequeo global reporta 4.359 errores y 1.154 warnings; los errores
restantes pertenecen al mismo baseline y no se añadieron disables.

El esquema del repositorio se aplica como esquema limpio. `db:init` no convierte
una base anterior que conserve `total_assigned` ni agrega la columna nueva a una
tabla existente. Un despliegue con datos que deban preservarse necesita un
procedimiento de migración explícito y un corte coordinado; no se ejecutó un
reset destructivo ni se declaró despliegue.

Este cierre local no prueba Keychain real, dos navegadores, un proveedor Hive
desplegado ni Turso remoto. La finalidad está cubierta contra el contrato de
estados del adapter, incluyendo `expired_irreversible`, y fixtures locales; falta evidencia operativa de una
transacción real atravesando reversible e irreversible. Tampoco implementa pagos HIVE/HBD, pricing,
treasury u órdenes. Esa fase debe usar `HivePaymentAdapter`, referencias
`hive:payment:<txid>:<op_index>` y `grantAvailableCredits()` después de fijar esos
contratos.
