import { getInviteIdentity } from './auth'
import { canUseInviteTicket } from './grants'
import type { InviteIdentity } from './types'

export type InviteTicketAuthorization =
  | { readonly allowed: true; readonly identity: InviteIdentity | null }
  | { readonly allowed: false }

export async function authorizeInviteTicket(
  request: Request,
  ticketCode: string
): Promise<InviteTicketAuthorization> {
  if (await canUseInviteTicket(ticketCode)) {
    return { allowed: true, identity: null }
  }
  const identity = await getInviteIdentity(request)
  return identity &&
    (await canUseInviteTicket(ticketCode, identity.identityHash))
    ? { allowed: true, identity }
    : { allowed: false }
}
