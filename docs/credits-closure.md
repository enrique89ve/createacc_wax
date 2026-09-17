# Credits v1: cierre local

Estado: implementado en ocho commits sobre `main`.

La serie dejó el claim en un flujo persistente y atómico: el intent se guarda en
`CreditClaimIntents`, Hive produce evidencia normalizada con índice de operación,
y una única transacción elimina el intent, mueve `pending_amount` a
`available_amount` e inserta `CreditAudit.external_reference`. El `Map` y el
mapping opaco en memoria fueron eliminados. Los grants y ajustes administrativos
escriben mediante Credits Core. `total_assigned` se llama ahora `total_issued` en
el esquema y en los contratos activos. `transferCredits()` ya no se exporta;
eventos históricos `transfer_in/out` siguen incluidos en el diagnóstico.

Commits aplicados:

- `bf9fc53` `docs: plan credits v1 closure`
- `fbc59fa` `feat(credits): add persistent claim schema and audit references`
- `cc6a075` `refactor(credits): isolate hive claim verification`
- `f56620a` `fix(credits): complete claims atomically from persistent intents`
- `493b938` `refactor(credits): centralize grants and admin adjustments`
- `3e6ff5b` `refactor(credits): remove unused builder transfers`
- `c8dbeda` `refactor(credits): rename total assigned to total issued`
- `HEAD` `test(credits): verify cross-process claims and document v1 closure`

Validación local ejecutada el 2026-09-16 con Node Linux 24.19.0 y pnpm 11.22.0,
usando una DB SQLite temporal y sin credenciales de Turso:

```text
pnpm test                         27 files / 130 tests passed
pnpm exec tsc --noEmit            passed
pnpm build                        passed
pnpm exec vitest run ...          adapter, schema, claim, core, stateless passed
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
verify` no se declaran verdes globalmente hasta resolver ese baseline.

El esquema del repositorio se aplica como esquema limpio. `db:init` no convierte
una base anterior que conserve `total_assigned` ni agrega la columna nueva a una
tabla existente. Un despliegue con datos que deban preservarse necesita un
procedimiento de migración explícito y un corte coordinado; no se ejecutó un
reset destructivo ni se declaró despliegue.

Este cierre local no prueba Keychain real, dos navegadores, irreversibilidad Hive,
Turso remoto ni un entorno desplegado. Tampoco implementa pagos HIVE/HBD, pricing,
treasury u órdenes. Esa fase debe usar `HivePaymentAdapter`, referencias
`hive:payment:<txid>:<op_index>` y `grantAvailableCredits()` después de fijar esos
contratos.
