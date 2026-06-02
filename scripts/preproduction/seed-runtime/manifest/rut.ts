export function computeRutDv(body: string): string {
  let multiplier = 2
  let sum = 0

  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier
    multiplier = multiplier === 7 ? 2 : multiplier + 1
  }

  const remainder = 11 - (sum % 11)
  if (remainder === 11) {
    return '0'
  }

  if (remainder === 10) {
    return 'K'
  }

  return String(remainder)
}

export function isValidRut(body: string, dv: string): boolean {
  return computeRutDv(body) === dv.toUpperCase()
}