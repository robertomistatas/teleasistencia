import { useEffect, useMemo, useState } from 'react'

import { Badge, Panel, primaryButtonClass, secondaryButtonClass } from '@/components/ui'
import {
	fetchActiveTeleoperatorOptions,
	getReassignResponsibleErrorMessage,
	reassignBeneficiaryPrimaryAssignment,
} from '@/features/assignments/data'
import type {
	AssignmentPortfolioBeneficiary,
	AssignmentTeleoperatorOption,
	ReassignBeneficiaryPrimaryAssignmentResult,
} from '@/features/assignments/types'
import { formatDateTime } from '@/lib/format'

export function ChangeResponsibleDialog({
	beneficiary,
	excludedUserIds,
	onClose,
	onSuccess,
}: {
	beneficiary: AssignmentPortfolioBeneficiary
	excludedUserIds: string[]
	onClose: () => void
	onSuccess: (result: ReassignBeneficiaryPrimaryAssignmentResult) => void
}) {
	const [options, setOptions] = useState<AssignmentTeleoperatorOption[]>([])
	const [loadingOptions, setLoadingOptions] = useState(true)
	const [optionsError, setOptionsError] = useState<string | null>(null)
	const [newResponsibleId, setNewResponsibleId] = useState('')
	const [reason, setReason] = useState('')
	const [submitting, setSubmitting] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false

		const loadOptions = async () => {
			setLoadingOptions(true)
			setOptionsError(null)

			try {
				const nextOptions = await fetchActiveTeleoperatorOptions(excludedUserIds)

				if (cancelled) {
					return
				}

				setOptions(nextOptions)
				setNewResponsibleId(nextOptions[0]?.id ?? '')
			} catch {
				if (cancelled) {
					return
				}

				setOptions([])
				setNewResponsibleId('')
				setOptionsError('No fue posible cargar las teleoperadoras disponibles para el cambio.')
			} finally {
				if (!cancelled) {
					setLoadingOptions(false)
				}
			}
		}

		void loadOptions()

		return () => {
			cancelled = true
		}
	}, [excludedUserIds])

	const selectedResponsible = useMemo(
		() => options.find((option) => option.id === newResponsibleId) ?? null,
		[newResponsibleId, options],
	)

	const canSubmit = !loadingOptions
		&& options.length > 0
		&& newResponsibleId.length > 0
		&& reason.trim().length > 0
		&& !submitting

	const handleSubmit = async () => {
		if (!canSubmit) {
			return
		}

		setSubmitting(true)
		setSubmitError(null)

		try {
			const result = await reassignBeneficiaryPrimaryAssignment({
				beneficiaryId: beneficiary.beneficiaryId,
				newAssignedUserId: newResponsibleId,
				reason: reason.trim(),
			})

			onSuccess(result)
		} catch (error) {
			setSubmitError(getReassignResponsibleErrorMessage(error))
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm">
			<div className="w-full max-w-3xl">
				<Panel className="p-6 sm:p-7">
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="text-sm uppercase tracking-[0.18em] text-slate-500">Cambio individual</p>
							<h3 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
								Cambiar responsable
							</h3>
							<p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
								Esta acción cambia la responsable oficial vigente de un solo beneficiario. El historial se conservará automáticamente.
							</p>
						</div>
						<button
							type="button"
							className={secondaryButtonClass}
							onClick={onClose}
							disabled={submitting}
						>
							Cerrar
						</button>
					</div>

					<div className="mt-6 grid gap-4 lg:grid-cols-2">
						<div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
							<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Beneficiario</p>
							<p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
								{beneficiary.beneficiaryName}
							</p>
							<p className="mt-1 text-sm text-slate-500">{beneficiary.commune || 'Comuna sin dato'}</p>
						</div>
						<div className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
							<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Responsable actual</p>
							<p className="mt-3 text-lg font-semibold tracking-tight text-slate-950">
								{beneficiary.teleoperatorName}
							</p>
							<p className="mt-1 text-sm text-slate-500">
								{beneficiary.teleoperatorEmail || 'Correo no visible'}
							</p>
						</div>
					</div>

					<div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
						<label className="block">
							<span className="text-sm font-medium text-slate-700">Nuevo responsable</span>
							<select
								className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
								value={newResponsibleId}
								onChange={(event) => setNewResponsibleId(event.target.value)}
								disabled={loadingOptions || options.length === 0 || submitting}
							>
								{loadingOptions && <option value="">Cargando responsables disponibles...</option>}
								{!loadingOptions && options.length === 0 && (
									<option value="">No hay otra teleoperadora activa disponible</option>
								)}
								{options.map((option) => (
									<option key={option.id} value={option.id}>
										{option.fullName}
									</option>
								))}
							</select>
						</label>

						<label className="block">
							<span className="text-sm font-medium text-slate-700">Motivo del cambio</span>
							<textarea
								className="mt-2 min-h-[120px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder="Explica por qué cambia la responsable oficial de este beneficiario"
								disabled={submitting}
							/>
						</label>
					</div>

					{optionsError && (
						<p className="mt-4 text-sm text-rose-700">{optionsError}</p>
					)}

					{!loadingOptions && options.length === 0 && !optionsError && (
						<div className="mt-4 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
							No hay otra teleoperadora activa disponible para transferir este beneficiario.
						</div>
					)}

					<div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4">
						<div className="flex flex-wrap gap-2">
							<Badge tone="info">Responsable actual</Badge>
							<Badge tone="success">Nuevo responsable</Badge>
							<Badge tone="muted">Historial conservado</Badge>
						</div>
						<div className="mt-4 grid gap-3 sm:grid-cols-2">
							<div>
								<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Responsable actual</p>
								<p className="mt-2 text-base font-semibold text-slate-950">{beneficiary.teleoperatorName}</p>
							</div>
							<div>
								<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Nuevo responsable</p>
								<p className="mt-2 text-base font-semibold text-slate-950">
									{selectedResponsible?.fullName || 'Selecciona una teleoperadora'}
								</p>
							</div>
							<div>
								<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Fecha efectiva</p>
								<p className="mt-2 text-base font-semibold text-slate-950">
									{formatDateTime(new Date().toISOString())}
								</p>
							</div>
							<div>
								<p className="text-xs uppercase tracking-[0.16em] text-slate-500">Impacto</p>
								<p className="mt-2 text-sm leading-6 text-slate-700">
									El historial se conservará. Esta acción cambia el responsable oficial vigente.
								</p>
							</div>
						</div>
					</div>

					{submitError && (
						<p className="mt-4 text-sm text-rose-700">{submitError}</p>
					)}

					<div className="mt-6 flex flex-wrap justify-end gap-3">
						<button
							type="button"
							className={secondaryButtonClass}
							onClick={onClose}
							disabled={submitting}
						>
							Cancelar
						</button>
						<button
							type="button"
							className={primaryButtonClass}
							onClick={() => void handleSubmit()}
							disabled={!canSubmit}
						>
							{submitting ? 'Guardando cambio...' : 'Confirmar cambio'}
						</button>
					</div>
				</Panel>
			</div>
		</div>
	)
}