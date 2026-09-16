import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRIVATE_KEY_FIELD_NAMES } from '@/types/keys'

const SRC_ROOT = path.resolve(import.meta.dirname, '../..')
const STORAGE_APIS = [
	'localStorage',
	'sessionStorage',
	'document.cookie',
	'URLSearchParams',
] as const

function walk(dir: string): string[] {
	const entries = readdirSync(dir)
	const files: string[] = []
	for (const entry of entries) {
		const full = path.join(dir, entry)
		const stat = statSync(full)
		if (stat.isDirectory()) {
			files.push(...walk(full))
			continue
		}
		if (/\.(ts|astro|js)$/.test(entry) && !entry.endsWith('.test.ts')) {
			files.push(full)
		}
	}
	return files
}

function lineWindows(content: string, index: number, radius = 12): string {
	const lines = content.split('\n')
	let seen = 0
	let hit = 0
	for (let i = 0; i < lines.length; i++) {
		seen += lines[i].length + 1
		if (seen > index) {
			hit = i
			break
		}
	}
	return lines.slice(Math.max(0, hit - radius), hit + radius + 1).join('\n')
}

describe('client key secret surface', () => {
	const files = walk(SRC_ROOT)

	it('does not put master keys in DOM attributes', () => {
		const hits = files.filter((file) =>
			readFileSync(file, 'utf8').includes('data-master-key')
		)
		expect(hits).toEqual([])
	})

	it('does not write private key fields into storage, cookies, or query strings', () => {
		const violations: string[] = []
		for (const file of files) {
			const content = readFileSync(file, 'utf8')
			for (const api of STORAGE_APIS) {
				let from = 0
				while (from < content.length) {
					const index = content.indexOf(api, from)
					if (index === -1) break
					const window = lineWindows(content, index)
					for (const field of PRIVATE_KEY_FIELD_NAMES) {
						const fieldPattern = new RegExp(`\\b${field}\\b`)
						if (fieldPattern.test(window)) {
							violations.push(
								`${path.relative(SRC_ROOT, file)}: ${api} near ${field}`
							)
						}
					}
					from = index + api.length
				}
			}
		}
		expect(violations).toEqual([])
	})

	it('does not stringify private key objects in the details fetch path', () => {
		const fetchFiles = files.filter((file) => {
			const relative = path.relative(SRC_ROOT, file)
			return (
				relative.startsWith('lib/details/') ||
				relative === 'components/AccountDetails.astro'
			)
		})
		const forbidden = [
			'JSON.stringify(hiveKeys)',
			'JSON.stringify(allKeys)',
			'JSON.stringify(this.state.allKeys)',
			'JSON.stringify(session)',
		]
		const hits: string[] = []
		for (const file of fetchFiles) {
			const content = readFileSync(file, 'utf8')
			for (const needle of forbidden) {
				if (content.includes(needle)) {
					hits.push(`${path.relative(SRC_ROOT, file)}: ${needle}`)
				}
			}
		}
		expect(hits).toEqual([])
	})
})
