import './test-setup-env.ts'
import { HIVE_TX_MODE_VALUES } from '../src/consts/hive-execution.ts'

const [ticketCode, correlationId, username] = process.argv.slice(2)
if (!ticketCode || !correlationId || !username) {
  throw new Error('ticket code, correlation ID and username are required')
}

process.stdout.write('READY\n')
let input = ''
for await (const chunk of process.stdin) {
  input += chunk.toString()
  if (input.includes('\n')) break
}
if (input.trim() !== 'go')
  throw new Error('reservation worker was not released')

const { reserveTicketCredit } = await import(
  '../src/utils/db-ticket-validator.ts'
)
const result = await reserveTicketCredit({
  ticketCode,
  correlationId,
  username,
  keys: {
    ownerPublicKey: 'STM7ownerCrossProcessTest',
    activePublicKey: 'STM7activeCrossProcessTest',
    postingPublicKey: 'STM7postingCrossProcessTest',
    memoPublicKey: 'STM7memoCrossProcessTest',
  },
  executionMode: HIVE_TX_MODE_VALUES.SIMULATE,
})
process.stdout.write(`RESULT:${JSON.stringify(result)}\n`)
