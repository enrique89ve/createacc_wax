export function interpolate(
  template: string,
  params: Readonly<Record<string, string>>
): string {
  return Object.entries(params).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template
  )
}
