import { validateTicket, cleanTicket } from '@/utils/validate-ticket'
import { obtainPowSolution } from '@/utils/pow-solver'
import { ensureTimingMatured } from '@/utils/timing-maturation'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import type { FormElements } from './types'

export function showTicketError(elements: FormElements, message: string): void {
	elements.ticketInput.classList.add('border-red-500')
	elements.ticketError.textContent = message
	elements.ticketError.classList.remove('hidden')
}

export function setTicketLoadingState(elements: FormElements, ticket: string): void {
	const message = ticket
		? 'Validando ticket...'
		: 'Obteniendo ticket...'
	elements.ticketInput.disabled = true
	elements.ticketApplyBtn.disabled = true
	elements.ticketApplyBtn.textContent = message
}

export function showTicketApplied(elements: FormElements, ticket: string): void {
	elements.ticketChipCode.textContent = ticket
	elements.ticketInputContainer.classList.add('hidden')
	elements.ticketChip.classList.remove('hidden')
	elements.ticketError.classList.add('hidden')
}

export function resetTicketInput(elements: FormElements): void {
	elements.ticketInput.disabled = false
	elements.ticketApplyBtn.textContent = 'Aplicar'
	elements.ticketApplyBtn.disabled = false
}

export function removeTicket(elements: FormElements): void {
	elements.ticketChip.classList.add('hidden')
	elements.ticketInputContainer.classList.remove('hidden')
	elements.ticketInput.value = ''
	elements.ticketInput.disabled = false
	elements.ticketApplyBtn.textContent = 'Aplicar'
	elements.ticketApplyBtn.disabled = true
	elements.ticketError.classList.add('hidden')
	elements.ticketInput.classList.remove('border-red-500')
	elements.ticketInput.focus()
}

export function handleTicketInputChange(elements: FormElements): boolean {
	const cleaned = cleanTicket(elements.ticketInput.value)

	if (cleaned !== elements.ticketInput.value) {
		const pos = elements.ticketInput.selectionStart || 0
		elements.ticketInput.value = cleaned
		const newPos = Math.min(pos, cleaned.length)
		elements.ticketInput.setSelectionRange(newPos, newPos)
	}

	elements.ticketError.classList.add('hidden')
	elements.ticketInput.classList.remove('border-red-500')

	if (!cleaned) return false

	const localError = validateTicket(cleaned)
	return localError === null
}

export interface ApplyTicketDeps {
	readonly elements: FormElements
	readonly ensureTicketTimingToken: () => Promise<string>
	readonly getTicketTimingTokenFetchedAt: () => number
	readonly onTicketValid: (ticket: string) => void
	readonly onTicketInvalid: () => void
}

export type ApplyTicketResult =
	| { readonly status: 'applied'; readonly ticket: string }
	| { readonly status: 'invalid' }
	| { readonly status: 'error' }

export async function applyTicket(deps: ApplyTicketDeps): Promise<ApplyTicketResult> {
	const { elements, ensureTicketTimingToken, getTicketTimingTokenFetchedAt } = deps

	const ticket = cleanTicket(elements.ticketInput.value)
	const localError = validateTicket(ticket)
	if (localError) {
		showTicketError(elements, localError)
		deps.onTicketInvalid()
		return { status: 'invalid' }
	}

	setTicketLoadingState(elements, ticket)

	// Resolve timing token + PoW in parallel: overlaps network + CPU time
	const resolved = await Promise.all([
		ensureTicketTimingToken(),
		obtainPowSolution(),
	]).catch(() => null)

	if (!resolved) {
		showTicketError(elements, 'Error de verificación. Inténtalo de nuevo.')
		resetTicketInput(elements)
		deps.onTicketInvalid()
		return { status: 'error' }
	}

	const [resolvedToken, pow] = resolved

	// Reads live value via getter — PoW solving time counts toward maturation
	await ensureTimingMatured(getTicketTimingTokenFetchedAt(), TIMING_THRESHOLDS.ticket)

	elements.ticketApplyBtn.textContent = '...'

	try {
		const response = await fetch('/api/validate/ticket', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ticket, pow, timingTokenId: resolvedToken }),
		})
		const result = await response.json()
		if (response.ok && result.valid) {
			showTicketApplied(elements, ticket)
			deps.onTicketValid(ticket)
			return { status: 'applied', ticket }
		}
		showTicketError(elements, result.error || 'Ticket inválido')
		elements.ticketInput.disabled = false
	} catch {
		showTicketError(elements, 'Error validando ticket. Inténtalo de nuevo.')
		elements.ticketInput.disabled = false
	}

	deps.onTicketInvalid()
	resetTicketInput(elements)
	return { status: 'invalid' }
}
