"use client"

import { useState } from "react"

import { useAuthSearchParams } from "@/lib/client/use-auth-search-params"
import { showActionFeedback } from "@/lib/client/action-feedback"
import { FIELD_CLASS, LABEL_CLASS, ModalShell, PRIMARY_BUTTON, SECONDARY_BUTTON, apiRequest } from "@/components/employees/shared"

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
      <div className="grid gap-4">
        <div className={config.hasCode ? "grid gap-4 sm:grid-cols-[1fr_10rem]" : "grid"}>
          <label className={LABEL_CLASS}>
            Name
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
              Project code
              <input value={form.code} onChange={update("code")} placeholder="Optional" className={FIELD_CLASS} />
            </label>
          ) : null}
        </div>
        <label className={LABEL_CLASS}>
          Description
          <textarea
            value={form.description}
            onChange={update("description")}
            rows={3}
            placeholder="Optional"
            className={`${FIELD_CLASS} h-auto py-2`}
          />
        </label>
      </div>
    </ModalShell>
  )
}
