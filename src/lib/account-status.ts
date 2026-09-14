import { BLOCKCHAIN_STATUS } from '@/consts/hive-execution'

export type AccountStatusLabel = 'SIMULATED' | 'CONFIRMED' | 'FAILED'

export function toAccountStatusLabel(status: string | null | undefined): AccountStatusLabel {
	if (status === BLOCKCHAIN_STATUS.SIMULATED) return 'SIMULATED'
	if (status === BLOCKCHAIN_STATUS.FAILED) return 'FAILED'
	return 'CONFIRMED'
}

export function isSimulatedAccount(status: string | null | undefined): boolean {
	return status === BLOCKCHAIN_STATUS.SIMULATED
}
