"use client"

import { useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { FIELD_CLASS, FieldLabel, FormSection, LABEL_CLASS, ModalShell, PRIMARY_BUTTON, SECONDARY_BUTTON, apiRequest } from "@/components/employees/shared"

const ICONS = {
  department: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
      <path d="M14 10h5a1 1 0 0 1 1 1v10" />
      <path d="M8 8h2M8 12h2M8 16h2M3 21h18" />
    </svg>
  ),
  project: (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
}

const DESCRIPTIONS = {
  department: "Group employees by team so you can assign an assessment to everyone in it at once.",
  project: "Group employees working together; an employee can belong to several projects.",
}

export const ORG_UNIT_KINDS = {
  department: { label: "Department", plural: "Departments", api: "/api/departments", path: "/employees/departments", hasCode: false },
  project: { label: "Project", plural: "Projects", api: "/api/projects", path: "/employees/projects", hasCode: true },
}

/** Create or edit a department / project. Pass `unit` to edit. */
export default function OrgUnitFormModal(props) {
  if (!props.open) return null
  // Keyed so each open starts from the unit being edited (or blank).
  return <OrgUnitForm key={props.unit?.id ?? "new"} {...props} />
}

function OrgUnitForm({ kind, open, unit = null, onClose, onSaved }) {
  const searchParams = useAuthSearchParams()
  const config = ORG_UNIT_KINDS[kind]
  const isEdit = Boolean(unit)
  const [form, setForm] = useState(() => ({
    name: unit?.name ?? "",
    code: unit?.code ?? "",
    description: unit?.description ?? "",
  }))
  const [saving, setSaving] = useState(false)

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))

  const handleSave = async () => {
    if (!form.name.trim()) {
      showActionFeedback({ tone: "error", title: "Missing details", message: `${config.label} name is required.` })
      return
    }
    setSaving(true)
    const res = await apiRequest(isEdit ? `${config.api}/${unit.id}` : config.api, searchParams, {
      method: isEdit ? "PATCH" : "POST",
      body: {
        name: form.name.trim(),
        description: form.description.trim() || null,
        ...(config.hasCode ? { code: form.code.trim() || null } : {}),
      },
    })
    setSaving(false)

    if (!res.ok) {
      showActionFeedback({ tone: "error", title: "Save failed", message: res.error?.message || `Failed to save ${config.label.toLowerCase()}` })
      return
    }
    showActionFeedback({ tone: "success", title: isEdit ? `${config.label} updated` : `${config.label} created`, message: res.data?.name })
    onClose()
    onSaved?.(res.data)
  }

  return (
    <ModalShell
      open={open}
      onClose={() => !saving && onClose()}
      busy={saving}
      labelledBy={`${kind}-form-title`}
      eyebrow={config.plural}
      title={isEdit ? `Edit ${config.label.toLowerCase()}` : `Create ${config.label.toLowerCase()}`}
      description={DESCRIPTIONS[kind]}
      icon={ICONS[kind]}
      footerNote={
        <>
          <span className="text-rose-300">*</span> Required
        </>
      }
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className={SECONDARY_BUTTON}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={PRIMARY_BUTTON}>
            {saving ? "Saving..." : isEdit ? "Save changes" : `Create ${config.label.toLowerCase()}`}
          </button>
        </>
      }
    >
      <FormSection number={1} title={`${config.label} details`} hint={kind === "project" ? "A short code helps you tell similar projects apart." : undefined}>
        <div className={config.hasCode ? "grid gap-4 sm:grid-cols-[1fr_10rem]" : "grid"}>
          <label className={LABEL_CLASS}>
            <FieldLabel required>Name</FieldLabel>
            <input
              value={form.name}
              onChange={update("name")}
              placeholder={kind === "project" ? "e.g. Project Alpha" : "e.g. Engineering"}
              className={FIELD_CLASS}
              autoFocus
            />
          </label>
          {config.hasCode ? (
            <label className={LABEL_CLASS}>
              <FieldLabel>Project code</FieldLabel>
              <input value={form.code} onChange={update("code")} placeholder="e.g. ALPHA" className={FIELD_CLASS} />
            </label>
          ) : null}
        </div>
        <label className={LABEL_CLASS}>
          <FieldLabel>Description</FieldLabel>
          <textarea
            value={form.description}
            onChange={update("description")}
            rows={3}
            placeholder={kind === "project" ? "What is this project about?" : "What does this team do?"}
            className={`${FIELD_CLASS} h-auto py-2`}
          />
        </label>
      </FormSection>
    </ModalShell>
  )
}
