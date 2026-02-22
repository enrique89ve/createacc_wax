export interface CopyFeedbackElements {
	readonly feedback: HTMLElement
	readonly keyDisplay: HTMLElement
}

export async function copyToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text)
		return true
	} catch {
		return false
	}
}

export function showCopyFeedback(
	elements: CopyFeedbackElements,
	currentTimeout: number | undefined,
): number | undefined {
	if (currentTimeout) {
		clearTimeout(currentTimeout)
	}

	elements.feedback.classList.remove('animate-fade-in', 'animate-fade-out')
	elements.feedback.classList.remove('hidden')
	elements.feedback.classList.add('flex', 'animate-fade-in')

	const outerTimeout = window.setTimeout(() => {
		elements.feedback.classList.remove('animate-fade-in')
		elements.feedback.classList.add('animate-fade-out')
		window.setTimeout(() => {
			elements.feedback.classList.add('hidden')
			elements.feedback.classList.remove('animate-fade-out', 'flex')
			elements.keyDisplay.classList.remove('blur-md', 'brightness-50')
		}, 240)
	}, 1500)

	return outerTimeout
}

export async function copyMasterKey(
	masterKey: string,
	trigger: HTMLElement,
	feedbackElements: CopyFeedbackElements,
	currentTimeout: number | undefined,
): Promise<number | undefined> {
	if (!masterKey) return currentTimeout

	const success = await copyToClipboard(masterKey)
	if (!success) return currentTimeout

	trigger.classList.add('ring-2', 'ring-gray-400')

	// Apply blurred glass effect (CSS transition handles the animation)
	feedbackElements.keyDisplay.classList.add('blur-md', 'brightness-50')

	const timeout = showCopyFeedback(feedbackElements, currentTimeout)

	setTimeout(() => trigger.classList.remove('ring-2', 'ring-gray-400'), 800)
	setTimeout(() => trigger.blur(), 0)

	return timeout
}
