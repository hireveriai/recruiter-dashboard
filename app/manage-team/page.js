"use client";

import { useEffect, useMemo, useState } from "react";

import { buildAuthUrl } from "@/lib/client/auth-query";
import { formatDate } from "@/lib/client/date-format";
import { formatLabel } from "@/lib/client/format-label";
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";
import BackToDashboardLink from "@/components/BackToDashboardLink";
import { FIELD_CLASS, FieldLabel, FormSection, LABEL_CLASS, ModalShell } from "@/components/employees/shared";
import { VerisGlobeLoader } from "@/components/system/loaders";

function getPlatformRoleTone(role) {
  if (role === "ADMIN" || role === "ORG_OWNER") {
    return "bg-amber-500/10 text-amber-200 border-amber-400/20";
  }

  return "bg-cyan-500/10 text-cyan-200 border-cyan-400/20";
}

function getOrgRoleTone(code) {
  if (!code) {
    return "bg-slate-900/70 text-slate-300 border-slate-700";
  }

  const normalized = code.toLowerCase();

  if (normalized.includes("admin") || normalized.includes("founder") || normalized.includes("super")) {
    return "bg-violet-500/10 text-violet-200 border-violet-400/20";
  }

  if (normalized.includes("manager")) {
    return "bg-amber-500/10 text-amber-200 border-amber-400/20";
  }

  return "bg-emerald-500/10 text-emerald-200 border-emerald-400/20";
}

const ENTITLEMENT_LABELS = {
  AI_INTERVIEW: "AI Interview",
  SCREENING: "Screening",
  ASSESSMENT: "Assessment",
  EMPLOYEE_ACTIVITIES: "Employee Activities",
};

function getPlanModules(entitlements) {
  if (!entitlements) {
    return [];
  }

  return Object.keys(ENTITLEMENT_LABELS).filter((code) => entitlements[code]).map((code) => ENTITLEMENT_LABELS[code]);
}

function getMemberRoleLabel(member) {
  if (member?.isAdmin) {
    return "Global Administrator";
  }

  return member?.organizationRoleCode ? formatLabel(member.organizationRoleCode) : "Unassigned";
}

function getRoleDisplayName(role) {
  return role?.code ? formatLabel(role.code) : "Organization Role";
}

function getPermissionCodes(source) {
  return (source ?? []).map((permission) => permission.code).filter(Boolean);
}

function initialsOf(name, email) {
  const parts = String(name || email || "?").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// Permissions are grouped by the area before the first dot in their code, so
// ~40 raw codes read as six understandable areas.
const PERMISSION_GROUPS = [
  { key: "hiring", label: "Interviews & candidates", short: "Interviews", prefixes: ["interviews", "candidates", "reports"] },
  { key: "assessments", label: "VERIS Assessments", short: "Assessments", prefixes: ["assessments"] },
  { key: "employees", label: "Employees & activities", short: "Employees", prefixes: ["employees", "employeeActivities"] },
  { key: "intelligence", label: "AI, alerts & War Room", short: "AI & War Room", prefixes: ["ai", "alerts", "warroom"] },
  { key: "admin", label: "Team, organization & billing", short: "Admin", prefixes: ["users", "organization", "billing"] },
];

function groupPermissions(permissions) {
  const groups = PERMISSION_GROUPS.map((group) => ({ ...group, permissions: [] }));
  const other = { key: "other", label: "Other", short: "Other", prefixes: [], permissions: [] };

  for (const permission of permissions ?? []) {
    const prefix = String(permission.code ?? "").split(".")[0];
    const group = groups.find((item) => item.prefixes.includes(prefix)) ?? other;
    group.permissions.push(permission);
  }

  return [...groups, other].filter((group) => group.permissions.length > 0);
}

function permissionLabel(permission) {
  if (permission.description) {
    return permission.description;
  }

  return formatLabel(String(permission.code ?? "").split(".").slice(1).join(" ") || permission.code);
}

function ChevronIcon({ open }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function GroupCheckbox({ checked, indeterminate, onChange, label }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      ref={(element) => {
        if (element) element.indeterminate = indeterminate;
      }}
      onChange={onChange}
      aria-label={label}
      className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-cyan-500"
    />
  );
}

/** Grouped permission picker: one tick per area, expandable for detail. */
function PermissionSelector({ allPermissions, selectedPermissions, onChange }) {
  const groups = useMemo(() => groupPermissions(allPermissions), [allPermissions]);
  const selected = useMemo(() => new Set(selectedPermissions), [selectedPermissions]);
  const [openGroups, setOpenGroups] = useState({});

  const setCodes = (codes, enabled) => {
    const next = new Set(selected);
    codes.forEach((code) => (enabled ? next.add(code) : next.delete(code)));
    onChange([...next].sort());
  };

  if (allPermissions.length === 0) {
    return <p className="text-sm text-slate-400">No permission catalog is available.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-white">{selected.size}</span> of {allPermissions.length} permissions selected
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(getPermissionCodes(allPermissions).sort())}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-cyan-400/40 hover:text-white"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => onChange([])}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Clear
          </button>
        </div>
      </div>

      {groups.map((group) => {
        const codes = group.permissions.map((permission) => permission.code);
        const count = codes.filter((code) => selected.has(code)).length;
        const all = count === codes.length;
        const open = Boolean(openGroups[group.key]);

        return (
          <div
            key={group.key}
            className={`rounded-xl border transition ${count > 0 ? "border-cyan-400/25 bg-cyan-500/[0.06]" : "border-slate-800 bg-slate-950/40"}`}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <GroupCheckbox
                checked={all}
                indeterminate={count > 0 && !all}
                onChange={() => setCodes(codes, !all)}
                label={`All ${group.label} permissions`}
              />
              <button
                type="button"
                onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
              >
                <span className="truncate text-sm font-medium text-white">{group.label}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                  <span className={count > 0 ? "font-semibold text-cyan-200" : ""}>
                    {count}/{codes.length}
                  </span>
                  <ChevronIcon open={open} />
                </span>
              </button>
            </div>
            {open ? (
              <div className="grid gap-1 border-t border-slate-800/80 px-2 py-2 sm:grid-cols-2">
                {group.permissions.map((permission) => {
                  const checked = selected.has(permission.code);
                  return (
                    <label
                      key={permission.code}
                      className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-slate-800/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setCodes([permission.code], !checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 accent-cyan-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm leading-5 text-slate-200">{permissionLabel(permission)}</span>
                        <span className="block truncate font-mono text-[10px] text-slate-500">{permission.code}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Role as clickable cards; picking one loads that role's default permissions. */
function RolePicker({ roles, value, onChange }) {
  if (roles.length === 0) {
    return <p className="text-sm text-slate-400">No organization roles are available.</p>;
  }

  return (
    <div role="radiogroup" aria-label="Organization role" className="grid gap-2 sm:grid-cols-2">
      {roles.map((role) => {
        const id = String(role.recruiterRoleId);
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            className={`rounded-xl border px-3.5 py-3 text-left transition ${
              active
                ? "border-cyan-300/50 bg-cyan-500/10 ring-1 ring-cyan-300/30"
                : "border-slate-700 bg-slate-950/40 hover:border-slate-500"
            }`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-white">{getRoleDisplayName(role)}</span>
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-cyan-300 bg-cyan-400" : "border-slate-600"}`}>
                {active ? <span className="h-1.5 w-1.5 rounded-full bg-slate-950" /> : null}
              </span>
            </span>
            {role.description ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-400">{role.description}</span> : null}
            <span className="mt-1.5 block text-[11px] font-medium text-slate-500">{(role.permissions ?? []).length} default permissions</span>
          </button>
        );
      })}
    </div>
  );
}

function ErrorNote({ error }) {
  return error ? (
    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>
  ) : null;
}

const MODAL_PRIMARY =
  "hv-solid-action inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60";
const MODAL_SECONDARY =
  "inline-flex items-center justify-center rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white";

const TEAM_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M19 8v6M16 11h6" />
  </svg>
);

const SHIELD_ICON = (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.5 7.5 9.5 4.4-1 7.5-4.9 7.5-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

function AddUserModal({ isOpen, onClose, onSubmit, availableRoles, allPermissions, submitting, error }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [recruiterRoleId, setRecruiterRoleId] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState([]);

  useEffect(() => {
    if (!isOpen) {
      window.queueMicrotask(() => {
        setFullName("");
        setEmail("");
        setRecruiterRoleId("");
        setSelectedPermissions([]);
      });
    }
  }, [isOpen]);

  function handleRoleChange(value) {
    const role = availableRoles.find((item) => String(item.recruiterRoleId) === value);
    setRecruiterRoleId(value);
    setSelectedPermissions(getPermissionCodes(role?.permissions));
  }

  return (
    <ModalShell
      open={isOpen}
      onClose={onClose}
      busy={submitting}
      labelledBy="add-user-title"
      eyebrow="Team provisioning"
      title="Add user"
      description="Invite a recruiter into this organization. Their access starts from the role you pick and can be fine-tuned."
      icon={TEAM_ICON}
      maxWidth="max-w-3xl"
      footerNote="An invitation email is sent to them."
      footer={
        <>
          <button type="button" onClick={onClose} className={MODAL_SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit({ fullName, email, recruiterRoleId, permissionCodes: selectedPermissions })}
            className={MODAL_PRIMARY}
          >
            {submitting ? "Sending invite..." : "Send invite"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormSection number={1} title="Who you're inviting">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={LABEL_CLASS}>
              <FieldLabel required>Full name</FieldLabel>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="e.g. Ekta Bakshi" className={FIELD_CLASS} autoFocus />
            </label>
            <label className={LABEL_CLASS}>
              <FieldLabel required>Work email</FieldLabel>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" className={FIELD_CLASS} />
            </label>
          </div>
        </FormSection>

        <FormSection number={2} title="Organization role" hint="Sets their starting permissions.">
          <RolePicker roles={availableRoles} value={recruiterRoleId} onChange={handleRoleChange} />
        </FormSection>

        <FormSection number={3} title="Permissions" hint="Tick a whole area, or expand it to choose individual permissions.">
          <PermissionSelector allPermissions={allPermissions} selectedPermissions={selectedPermissions} onChange={setSelectedPermissions} />
        </FormSection>

        <ErrorNote error={error} />
      </div>
    </ModalShell>
  );
}

function EditUserModal({ isOpen, member, availableRoles, allPermissions, saving, error, onClose, onSubmit }) {
  const [recruiterRoleId, setRecruiterRoleId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [selectedPermissions, setSelectedPermissions] = useState([]);

  useEffect(() => {
    if (isOpen && member) {
      window.queueMicrotask(() => {
        setRecruiterRoleId(member.recruiterRoleId ? String(member.recruiterRoleId) : "");
        setIsActive(Boolean(member.isActive));
        setSelectedPermissions(getPermissionCodes(member.permissions));
      });
    }
  }, [isOpen, member]);

  function handleRoleChange(value) {
    const role = availableRoles.find((item) => String(item.recruiterRoleId) === value);
    setRecruiterRoleId(value);
    setSelectedPermissions(getPermissionCodes(role?.permissions));
  }

  return (
    <ModalShell
      open={Boolean(isOpen && member)}
      onClose={onClose}
      busy={saving}
      labelledBy="edit-user-title"
      eyebrow="Team access"
      title="Edit access"
      description="Change this member's role, workspace access and exact permissions."
      icon={SHIELD_ICON}
      maxWidth="max-w-3xl"
      footer={
        <>
          <button type="button" onClick={onClose} className={MODAL_SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSubmit({ userId: member.userId, recruiterRoleId, isActive, permissionCodes: selectedPermissions })}
            className={MODAL_PRIMARY}
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </>
      }
    >
      {member ? (
        <div className="space-y-4">
          <FormSection number={1} title="Member">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-semibold text-white">
                  {initialsOf(member.name, member.email)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{member.name}</p>
                  <p className="truncate text-sm text-slate-400">{member.email}</p>
                </div>
              </div>
              <div role="radiogroup" aria-label="Workspace access" className="grid h-10 grid-cols-2 gap-1 rounded-xl border border-slate-700 bg-slate-950/60 p-1">
                {[
                  { value: true, label: "Active" },
                  { value: false, label: "Disabled" },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="radio"
                    aria-checked={isActive === option.value}
                    onClick={() => setIsActive(option.value)}
                    className={`rounded-lg px-4 text-sm font-medium transition ${
                      isActive === option.value
                        ? option.value
                          ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30"
                          : "bg-slate-700/60 text-white ring-1 ring-slate-500/40"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </FormSection>

          <FormSection number={2} title="Organization role" hint="Changing the role resets permissions to that role's defaults.">
            <RolePicker roles={availableRoles} value={recruiterRoleId} onChange={handleRoleChange} />
          </FormSection>

          <FormSection number={3} title="Permissions" hint="Tick a whole area, or expand it to choose individual permissions.">
            <PermissionSelector allPermissions={allPermissions} selectedPermissions={selectedPermissions} onChange={setSelectedPermissions} />
          </FormSection>

          <ErrorNote error={error} />
        </div>
      ) : null}
    </ModalShell>
  );
}

/** One-line access summary per member instead of every permission card. */
function PermissionSummary({ member, allPermissions }) {
  const codes = new Set(getPermissionCodes(member.permissions));
  const catalog = allPermissions.length ? allPermissions : member.permissions ?? [];

  if (codes.size === 0) {
    return <span className="text-sm text-slate-500">No permissions</span>;
  }

  const full = allPermissions.length > 0 && allPermissions.every((permission) => codes.has(permission.code));

  return (
    <div className="min-w-0">
      <p className="text-sm font-medium text-white">
        {full ? "Full access" : `${codes.size}${allPermissions.length ? ` of ${allPermissions.length}` : ""} permissions`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {groupPermissions(catalog).map((group) => {
          const granted = group.permissions.filter((permission) => codes.has(permission.code));
          if (granted.length === 0) return null;
          const complete = granted.length === group.permissions.length;
          return (
            <span
              key={group.key}
              title={granted.map(permissionLabel).join("\n")}
              className={`cursor-help rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                complete ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900/70 text-slate-300"
              }`}
            >
              {group.short}
              {complete ? "" : ` ${granted.length}/${group.permissions.length}`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function inviteLabel(status) {
  if (status === "Expired") return { text: "Invite expired", tone: "text-rose-300", dot: "bg-rose-400" };
  if (status && status !== "Accepted") return { text: `Invite ${String(status).toLowerCase()}`, tone: "text-amber-300", dot: "bg-amber-400" };
  return { text: "Invite accepted", tone: "text-slate-400", dot: "bg-emerald-400" };
}

const ROW_BUTTON = "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60";

export default function ManageTeamPage() {
  const searchParams = useAuthSearchParams();
  const cacheKey = `manage-team:${searchParams.toString()}`;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);
  const [submitError, setSubmitError] = useState("");
  const [editError, setEditError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [rowActionUserId, setRowActionUserId] = useState("");
  const [rowActionType, setRowActionType] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const cached = readSessionJsonCache(cacheKey);

    if (cached) {
      window.queueMicrotask(() => {
        if (active) {
          setData(cached);
          setError("");
          setLoading(false);
        }
      });
    }

    if (cached && isSessionJsonCacheFresh(cacheKey)) {
      return () => {
        active = false;
      };
    }

    fetch(buildAuthUrl("/api/manage-team", searchParams))
      .then((res) => res.json())
      .then((payload) => {
        if (!active) {
          return;
        }

        if (payload.success) {
          setData(payload.data);
          writeSessionJsonCache(cacheKey, payload.data);
          setError("");
          return;
        }

        setError(payload.error?.message || payload.message || "Failed to load team workspace");
      })
      .catch((fetchError) => {
        console.error("Failed to load manage team data", fetchError);
        if (active) {
          setError("Failed to load team workspace");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cacheKey, searchParams]);

  const team = useMemo(() => data?.team ?? [], [data]);
  const availableRoles = useMemo(() => data?.availableRoles ?? [], [data]);
  const allPermissions = useMemo(() => data?.allPermissions ?? [], [data]);
  const canManageUsers = Boolean(data?.canManageUsers);
  const entitlements = data?.entitlements ?? null;
  const summary = data?.summary ?? {
    totalMembers: 0,
    activeMembers: 0,
    recruiters: 0,
    admins: 0,
  };

  async function handleAddUser(form) {
    setSubmitError("");
    setNotice("");

    if (!form.fullName?.trim() || !form.email?.trim() || !form.recruiterRoleId) {
      setSubmitError("Full name, email, and organization role are required.");
      return;
    }

    try {
      setSubmitting(true);
      const response = await fetch(buildAuthUrl("/api/manage-team", searchParams), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fullName: form.fullName,
          email: form.email,
          recruiterRoleId: Number(form.recruiterRoleId),
          permissionCodes: form.permissionCodes ?? [],
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || payload.message || "Failed to add team member");
      }

      setData(payload.data);
      writeSessionJsonCache(cacheKey, payload.data);
      setNotice(payload.message || "Invitation sent successfully");
      setIsModalOpen(false);
    } catch (submitErr) {
      setSubmitError(submitErr.message || "Failed to add team member");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveMemberEdit(form) {
    setEditError("");
    setNotice("");

    if (!form.userId || !form.recruiterRoleId) {
      setEditError("Organization role is required.");
      return;
    }

    try {
      setSavingEdit(true);
      const response = await fetch(buildAuthUrl("/api/manage-team", searchParams), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update-member",
          userId: form.userId,
          recruiterRoleId: Number(form.recruiterRoleId),
          isActive: Boolean(form.isActive),
          permissionCodes: form.permissionCodes ?? [],
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || payload.message || "Failed to update team member");
      }

      setData(payload.data);
      writeSessionJsonCache(cacheKey, payload.data);
      setNotice("Team member access updated successfully.");
      setIsEditModalOpen(false);
      setSelectedMember(null);
    } catch (saveErr) {
      setEditError(saveErr.message || "Failed to update team member");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleResendInvite(member) {
    setNotice("");
    setError("");
    setRowActionUserId(member.userId);
    setRowActionType("resend");

    try {
      const response = await fetch(buildAuthUrl("/api/manage-team", searchParams), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "resend-invite",
          userId: member.userId,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || payload.message || "Failed to resend access email");
      }

      setNotice("Invitation sent successfully");
    } catch (resendErr) {
      setError(resendErr.message || "Failed to resend access email");
    } finally {
      setRowActionUserId("");
      setRowActionType("");
    }
  }

  async function handleMemberAccessAction(member, action) {
    const isRemove = action === "remove-member";
    const message = isRemove
      ? `Remove ${member.name || member.email} from this organization? This will disable access and hide the user from Manage Team.`
      : action === "disable-member"
        ? `Disable access for ${member.name || member.email}?`
        : `Enable access for ${member.name || member.email}?`;

    if (isRemove && typeof window !== "undefined" && !window.confirm(message)) {
      return;
    }

    setNotice("");
    setError("");
    setRowActionUserId(member.userId);
    setRowActionType(action);

    try {
      const response = await fetch(buildAuthUrl("/api/manage-team", searchParams), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          userId: member.userId,
        }),
      });

      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || payload.message || "Failed to update team member access");
      }

      setData(payload.data);
      writeSessionJsonCache(`manage-team:${searchParams.toString()}`, payload.data);
      setNotice(payload.message || "Team member access updated successfully.");
    } catch (accessErr) {
      setError(accessErr.message || "Failed to update team member access");
    } finally {
      setRowActionUserId("");
      setRowActionType("");
    }
  }

  function openEditModal(member) {
    setEditError("");
    setSelectedMember(member);
    setIsEditModalOpen(true);
  }

  if (loading) {
    return (
      <VerisGlobeLoader
        eyebrow="Manage Team"
        steps={[
          { label: "Loading team", detail: "Fetching recruiter members and organization roles." },
          { label: "Syncing access", detail: "Preparing permissions, invite status, and admin controls." },
          { label: "Building workspace", detail: "Organizing team management data." },
          { label: "Team ready", detail: "Your team workspace is ready for review." },
        ]}
        activeIndex={1}
      />
    );
  }

  const planModules = getPlanModules(entitlements);
  const stats = [
    { label: "Team members", value: summary.totalMembers, tone: "text-white" },
    { label: "Active", value: summary.activeMembers, tone: "text-emerald-300" },
    { label: "Recruiters", value: summary.recruiters, tone: "text-cyan-300" },
    { label: "Global admins", value: summary.admins, tone: "text-amber-300" },
  ];
  const ROW_GRID = "xl:grid-cols-[minmax(220px,1.3fr)_minmax(160px,1fr)_140px_104px_minmax(220px,1.4fr)_208px]";

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-white sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-[0_14px_44px_rgba(2,6,23,0.22)] sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-950/35 px-4 py-2 text-sm text-slate-200 transition hover:border-blue-400/30 hover:bg-slate-900 hover:text-white" />
              <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-cyan-300/90">Recruiter administration</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Manage Team</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Invite teammates, set their organization role, and control exactly what each person can see and do.
              </p>
            </div>

            <div className="flex flex-col gap-3 lg:items-end">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 px-4 py-3 lg:max-w-sm lg:text-right">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Organization</p>
                <p className="mt-1 text-sm font-semibold text-white" aria-live="polite">
                  {data?.organization || "Workspace"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5 lg:justify-end">
                  {planModules.length ? (
                    planModules.map((module) => (
                      <span key={module} className="rounded-full border border-cyan-400/20 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-200">
                        {module}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">{entitlements ? "No active modules" : "Loading plan..."}</span>
                  )}
                </div>
              </div>
              {canManageUsers ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubmitError("");
                    setIsModalOpen(true);
                  }}
                  className="hv-solid-action inline-flex w-fit items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  <span aria-hidden="true" className="text-base leading-none">+</span> Add user
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-2xl border border-slate-800 bg-slate-950/30 px-5 py-4">
                <p className="text-sm text-slate-400">{stat.label}</p>
                <p className={`mt-2 text-3xl font-semibold tabular-nums ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
          </div>

          {notice ? (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-200">{notice}</div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">{error}</div>
          ) : null}

          <div className="mt-8 overflow-hidden rounded-[24px] border border-slate-800 bg-slate-950/30">
            <div className={`hidden items-center gap-4 border-b border-slate-800 px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 xl:grid ${ROW_GRID}`}>
              <div>Team member</div>
              <div>Role</div>
              <div>Status</div>
              <div>Joined</div>
              <div>Access</div>
              <div className="text-right">Actions</div>
            </div>

            {team.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate-400">No recruiter-side team members found for this organization.</div>
            ) : (
              team.map((member) => {
                const invite = inviteLabel(member.inviteStatus);
                const busy = rowActionUserId === member.userId;
                return (
                  <div
                    key={member.userId}
                    className={`grid min-w-0 grid-cols-1 items-start gap-4 border-b border-slate-800/70 px-4 py-5 transition last:border-b-0 hover:bg-slate-900/40 sm:px-6 md:grid-cols-2 ${ROW_GRID}`}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-sm font-semibold text-white">
                        {initialsOf(member.name, member.email)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-semibold text-white">{member.name}</p>
                          {member.isCurrentUser ? (
                            <span className="shrink-0 rounded-full border border-blue-400/20 bg-blue-500/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.12em] text-blue-200">
                              You
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-sm text-slate-400" title={member.email}>
                          {member.email}
                        </p>
                        <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${getPlatformRoleTone(member.platformRole)}`}>
                          {formatLabel(member.platformRole)}
                        </span>
                      </div>
                    </div>

                    <div className="min-w-0">
                      <span className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${getOrgRoleTone(member.isAdmin ? "Admin" : member.organizationRoleCode)}`}>
                        {getMemberRoleLabel(member)}
                      </span>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-400">
                        {member.organizationRoleDescription || "No role profile assigned"}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                          member.isActive ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200" : "border-slate-700 bg-slate-900/80 text-slate-400"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${member.isActive ? "bg-emerald-400" : "bg-slate-500"}`} />
                        {member.isActive ? "Active" : "Disabled"}
                      </span>
                      <p className={`flex items-center gap-1.5 text-xs ${invite.tone}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${invite.dot}`} />
                        {invite.text}
                      </p>
                    </div>

                    <div className="whitespace-nowrap text-sm text-slate-300">{formatDate(member.joinedAt)}</div>

                    <PermissionSummary member={member} allPermissions={allPermissions} />

                    <div className="xl:justify-self-end">
                      {canManageUsers && !member.isCurrentUser ? (
                        <div className="grid w-full grid-cols-2 gap-1.5 sm:w-52">
                          <button
                            type="button"
                            onClick={() => openEditModal(member)}
                            className={`${ROW_BUTTON} col-span-2 border-blue-400/30 bg-blue-500/10 text-blue-100 hover:bg-blue-500/20`}
                          >
                            Edit access
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleResendInvite(member)}
                            className={`${ROW_BUTTON} border-slate-700 text-slate-200 hover:border-cyan-400/40 hover:text-white`}
                          >
                            {busy && rowActionType === "resend" ? "Sending..." : member.inviteStatus === "Accepted" ? "Resend access" : "Resend invite"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleMemberAccessAction(member, member.isActive ? "disable-member" : "enable-member")}
                            className={`${ROW_BUTTON} ${
                              member.isActive
                                ? "border-amber-400/25 text-amber-200 hover:bg-amber-500/10"
                                : "border-emerald-400/25 text-emerald-200 hover:bg-emerald-500/10"
                            }`}
                          >
                            {busy && rowActionType !== "remove-member" && rowActionType !== "resend" ? "Updating..." : member.isActive ? "Disable" : "Enable"}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleMemberAccessAction(member, "remove-member")}
                            className={`${ROW_BUTTON} col-span-2 border-transparent text-rose-300 hover:border-rose-400/25 hover:bg-rose-500/10`}
                          >
                            {busy && rowActionType === "remove-member" ? "Removing..." : "Remove from team"}
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-slate-500">{member.isCurrentUser ? "This is you" : "No actions"}</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <AddUserModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddUser}
        availableRoles={availableRoles}
        allPermissions={allPermissions}
        submitting={submitting}
        error={submitError}
      />

      <EditUserModal
        isOpen={isEditModalOpen}
        member={selectedMember}
        availableRoles={availableRoles}
        allPermissions={allPermissions}
        saving={savingEdit}
        error={editError}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedMember(null);
        }}
        onSubmit={handleSaveMemberEdit}
      />
    </main>
  );
}
