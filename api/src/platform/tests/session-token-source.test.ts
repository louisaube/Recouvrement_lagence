import type { Request } from 'express'
import { SessionService } from '../security/session.service'

/** `SessionService.tokenSource`: strict reading of the Authorization header and of the session cookie. */
const sessions = new SessionService(undefined as never, undefined as never)

function request(headers: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))
  return { header: (name: string) => lower[name.toLowerCase()] } as unknown as Request
}

describe('SessionService.tokenSource', () => {
  const cookie = sessions.cookieName('localhost')
  const origin = { origin: 'http://localhost:5173' }

  it.each([
    ['Bearer abc', { kind: 'present', token: 'abc' }],
    ['Bearer abc extra', { kind: 'malformed' }],
    ['Bearer abc abc', { kind: 'malformed' }],
    ['Bearer  abc', { kind: 'present', token: 'abc' }],
    ['Bearer   abc', { kind: 'present', token: 'abc' }],
    [`Bearer${' '.repeat(10)}abc`, { kind: 'present', token: 'abc' }],
    ['bearer  abc', { kind: 'present', token: 'abc' }],
    ['BEARER   abc', { kind: 'present', token: 'abc' }],
    ['Bearer\tabc', { kind: 'malformed' }],
    ['Bearer \tabc', { kind: 'malformed' }],
    ['Bearer abc', { kind: 'malformed' }],
    ['Bearer  abc', { kind: 'malformed' }],
    ['Bearer abc  def', { kind: 'malformed' }],
    ['Bearer abc\tdef', { kind: 'malformed' }],
    ['Bearer abc def', { kind: 'malformed' }],
    ['Bearerabc', { kind: 'malformed' }],
    ['Basic abc', { kind: 'malformed' }],
    ['Token abc', { kind: 'malformed' }],
    ['abc', { kind: 'malformed' }],
    ['Bearer', { kind: 'malformed' }],
    ['Bearer ', { kind: 'malformed' }],
  ])('[rule-foundation-session-expired] Authorization %j → %j', (authorization, expected) => {
    expect(sessions.tokenSource(request({ authorization }))).toEqual(expected)
  })

  it('[rule-foundation-session-expired] an unreadable Authorization header wins over a valid cookie', () => {
    const req = request({ authorization: 'Bearer a b', cookie: `${cookie}=abc`, ...origin })
    expect(sessions.tokenSource(req)).toEqual({ kind: 'malformed' })
  })

  it.each([
    [`${cookie}=abc`, { kind: 'present', token: 'abc' }],
    [`other=1;${cookie}=abc`, { kind: 'present', token: 'abc' }],
    [`other=1; ${cookie}=abc ; x=2`, { kind: 'present', token: 'abc' }],
    [`${cookie}=`, { kind: 'none' }],
    [`x${cookie}=abc`, { kind: 'none' }],
    [`${cookie}x=abc`, { kind: 'none' }],
    [`${sessions.cookieName('example.org')}=abc`, { kind: 'none' }],
  ])('[rule-foundation-session-persists] Cookie %j → %j', (cookies, expected) => {
    expect(sessions.tokenSource(request({ cookie: cookies, ...origin }))).toEqual(expected)
  })
})
