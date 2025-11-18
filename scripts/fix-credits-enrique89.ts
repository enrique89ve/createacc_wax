/**
 * Script de corrección para créditos duplicados de enrique89
 *
 * PROBLEMA DETECTADO:
 * - Asignación duplicada de 100 créditos (IDs 7 y 8 en CreditAudit)
 * - Ambas ocurrieron en 2025-11-14 02:37:37
 * - Resultado: enrique89 tiene 321 créditos cuando debería tener 221
 *
 * CORRECCIÓN:
 * 1. Eliminar registro duplicado (ID 8) de CreditAudit
 * 2. Recalcular available_amount y total_assigned en Credits
 */

import { db } from '@/lib/database'

async function main() {
	console.log('🔍 Verificando créditos de enrique89...\n')

	// 1. Obtener builder_id
	const builderResult = await db.execute({
		sql: "SELECT id FROM Users WHERE username = 'enrique89' AND role = 'builder'",
		args: [],
	})

	if (builderResult.rows.length === 0) {
		console.error('❌ Builder enrique89 no encontrado')
		process.exit(1)
	}

	const builderId = Number(builderResult.rows[0].id)
	console.log(`✅ Builder encontrado: ID ${builderId}`)

	// 2. Mostrar estado actual
	const currentCredits = await db.execute({
		sql: 'SELECT * FROM Credits WHERE builder_id = ?',
		args: [builderId],
	})

	console.log('\n📊 Estado ACTUAL:')
	console.log(currentCredits.rows[0])

	// 3. Verificar asignación duplicada
	const duplicateAssign = await db.execute({
		sql: `
			SELECT id, amount, timestamp
			FROM CreditAudit
			WHERE builder_id = ?
				AND operation = 'assign_credits'
				AND timestamp = '2025-11-14 02:37:37'
			ORDER BY id
		`,
		args: [builderId],
	})

	console.log('\n🔍 Asignaciones duplicadas encontradas:')
	console.log(duplicateAssign.rows)

	if (duplicateAssign.rows.length !== 2) {
		console.error('❌ No se encontraron exactamente 2 registros duplicados')
		process.exit(1)
	}

	// 4. Calcular valores correctos
	const auditResult = await db.execute({
		sql: `
			SELECT
				SUM(CASE WHEN operation = 'assign_credits' THEN amount ELSE 0 END) as total_assigned,
				SUM(CASE WHEN operation = 'claim_credits' THEN amount ELSE 0 END) as total_claimed,
				SUM(CASE WHEN operation = 'create_ticket' THEN amount ELSE 0 END) as total_spent,
				SUM(CASE WHEN operation = 'delete_ticket_refund' THEN amount ELSE 0 END) as total_refunded
			FROM CreditAudit
			WHERE builder_id = ? AND id != 8
		`,
		args: [builderId],
	})

	const stats = auditResult.rows[0] as any
	const correctAssigned = Number(stats.total_assigned)
	const correctAvailable =
		Number(stats.total_claimed) +
		Number(stats.total_spent) +
		Number(stats.total_refunded)

	console.log('\n📐 Valores CORRECTOS (sin duplicado ID 8):')
	console.log(`  total_assigned: ${correctAssigned}`)
	console.log(`  available_amount: ${correctAvailable}`)

	// 5. Preguntar confirmación
	console.log('\n⚠️  CORRECCIÓN A REALIZAR:')
	console.log(`  1. Eliminar registro duplicado (CreditAudit ID 8)`)
	console.log(`  2. Actualizar Credits:`)
	console.log(`     - total_assigned: 221 → ${correctAssigned}`)
	console.log(`     - available_amount: 321 → ${correctAvailable}`)

	// Ejecutar corrección
	console.log('\n🔧 Ejecutando corrección...\n')

	try {
		await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

		// Eliminar duplicado
		await db.execute({
			sql: 'DELETE FROM CreditAudit WHERE id = 8',
			args: [],
		})
		console.log('✅ Registro duplicado eliminado (CreditAudit ID 8)')

		// Actualizar Credits
		await db.execute({
			sql: `
				UPDATE Credits
				SET
					total_assigned = ?,
					available_amount = ?,
					updated_at = CURRENT_TIMESTAMP
				WHERE builder_id = ?
			`,
			args: [correctAssigned, correctAvailable, builderId],
		})
		console.log('✅ Credits actualizado correctamente')

		await db.execute({ sql: 'COMMIT', args: [] })
		console.log('\n✅ Corrección completada exitosamente')

		// Verificar resultado final
		const finalCredits = await db.execute({
			sql: 'SELECT * FROM Credits WHERE builder_id = ?',
			args: [builderId],
		})

		console.log('\n📊 Estado FINAL:')
		console.log(finalCredits.rows[0])

	} catch (error) {
		await db.execute({ sql: 'ROLLBACK', args: [] })
		console.error('\n❌ Error durante la corrección:', error)
		process.exit(1)
	}
}

main()
	.then(() => {
		console.log('\n✅ Script completado')
		process.exit(0)
	})
	.catch((error) => {
		console.error('❌ Error:', error)
		process.exit(1)
	})
