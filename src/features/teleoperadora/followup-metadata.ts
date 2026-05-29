import type { FollowupEventType, FollowupStatus } from '@/lib/types'

export const followupStatusMeta: Record<
  FollowupStatus,
  {
    label: string
    tone: 'danger' | 'warning' | 'success' | 'muted'
    badgeClass: string
    panelClass: string
    accentClass: string
  }
> = {
  urgent: {
    label: 'Urgente',
    tone: 'danger',
    badgeClass: 'border-rose-300 bg-rose-600 text-white',
    panelClass: 'border-rose-200 bg-rose-50/90',
    accentClass: 'bg-rose-600',
  },
  pending: {
    label: 'Pendiente',
    tone: 'warning',
    badgeClass: 'border-amber-300 bg-amber-100 text-amber-950',
    panelClass: 'border-amber-200 bg-amber-50/90',
    accentClass: 'bg-amber-400',
  },
  up_to_date: {
    label: 'Al dia',
    tone: 'success',
    badgeClass: 'border-emerald-300 bg-emerald-600 text-white',
    panelClass: 'border-emerald-200 bg-emerald-50/90',
    accentClass: 'bg-emerald-600',
  },
  no_data: {
    label: 'Sin datos',
    tone: 'muted',
    badgeClass: 'border-slate-300 bg-slate-200 text-slate-700',
    panelClass: 'border-slate-200 bg-slate-100/90',
    accentClass: 'bg-slate-400',
  },
}

export const followupEventLabels: Record<FollowupEventType, string> = {
  contact_beneficiary: 'Hable con el beneficiario',
  contact_support_network: 'Hable con red de apoyo',
  no_answer: 'No contesto',
  phone_off: 'Telefono apagado',
  wrong_number: 'Numero incorrecto',
  requests_help: 'Solicita ayuda',
  support_referral: 'Derivado a soporte',
  internal_note: 'Solo registro interno',
}

export const contactTypeLabels: Record<string, string> = {
  primary_phone: 'Telefono principal',
  support_network: 'Red de apoyo',
  family_contact: 'Contacto familiar',
  emergency_contact: 'Contacto emergencia',
  app_phone: 'Telefono app',
  sim_phone: 'SIM / dispositivo',
  other: 'Otro contacto',
}

export const followupSourceLabels: Record<string, string> = {
  manual: 'Registro manual',
  amaia_call: 'Llamada AMAIA',
  system: 'Sistema',
}

export function getContactTypeLabel(contactType: string) {
  return contactTypeLabels[contactType] ?? contactType
}

export function getFollowupSourceLabel(source: string) {
  return followupSourceLabels[source] ?? source
}