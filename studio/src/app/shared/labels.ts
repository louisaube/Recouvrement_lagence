/** rule-foundation-role-label: unknown roles are shown as they are. */
export function roleLabel(role: string): string {
  if (role === 'admin') return 'Administrateur'
  if (role === 'user') return 'Utilisateur'
  return role
}
