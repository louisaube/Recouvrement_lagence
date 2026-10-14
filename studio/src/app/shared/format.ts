/** rule-recouvrement-ui-formats: French formats, integer arithmetic only for money and basis points. */
const NBSP = ' '

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

/** `123456` cents → « 1 234,56 € ». */
export function formatEuros(cents: number): string {
  const negative = cents < 0
  const abs = Math.abs(Math.trunc(cents))
  const euros = Math.trunc(abs / 100)
  const rest = String(abs % 100).padStart(2, '0')
  return `${negative ? '-' : ''}${group(String(euros))},${rest}${NBSP}€`
}

/** Basis points → percentage without useless decimals (8 500 → « 85 % », 8 250 → « 82,5 % »). */
export function formatBp(bp: number): string {
  const negative = bp < 0
  const abs = Math.abs(Math.trunc(bp))
  const whole = Math.trunc(abs / 100)
  const rest = String(abs % 100)
    .padStart(2, '0')
    .replace(/0+$/, '')
  return `${negative ? '-' : ''}${group(String(whole))}${rest ? `,${rest}` : ''}${NBSP}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `AAAA-MM-JJ` (or an instant) → `JJ/MM/AAAA`; an instant is read in the browser's time zone. */
export function formatDate(value: string): string {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (plain) return `${plain[3]}/${plain[2]}/${plain[1]}`
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** An instant → `JJ/MM/AAAA HH:mm` in the browser's time zone. */
export function formatDateTime(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Calendar date of today in Europe/Paris, `AAAA-MM-JJ`. */
export function todayInParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
