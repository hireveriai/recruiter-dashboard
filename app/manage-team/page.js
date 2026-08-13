"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { buildAuthUrl } from "@/lib/client/auth-query";
import { formatDate } from "@/lib/client/date-format";
import { isSessionJsonCacheFresh, readSessionJsonCache, writeSessionJsonCache } from "@/lib/client/session-json-cache";
import { useAuthSearchParams } from "@/lib/client/use-auth-search-params";
import BackToDashboardLink from "@/components/BackToDashboardLink";
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

function getMemberRoleLabel(member) {
  if (member?.isAdmin) {
    return "Global Administrator";
  }

  return member?.organizationRoleCode || "Unassigned";
}

function getRoleDisplayName(role) {
  return role?.code || "Organization Role";
}

function getPermissionCodes(source) {
  return (source ?? []).map((permission) => permission.code).filter(Boolean);
}

function getInviteStatusTone(status) {
  if (status === "Accepted") {
    return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "Expired") {
    return "border-rose-400/20 bg-rose-500/10 text-rose-200";
  }

  return "border-amber-400/20 bg-amber-500/10 text-amber-200";
}

function PermissionSelector({ allPermissions, selectedPermissions, onToggle, onSelectAll, onClear }) {
  return (
    <div className="mt-5 max-h-[320px] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/35 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Permissions</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-blue-400/30 hover:text-white"
          >
            Select All
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Clear
          </button>
        </div>
      </div>
      {allPermissions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No permission catalog is available.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {allPermissions.map((permission) => {
            const checked = selectedPermissions.includes(permission.code);

            return (
              <label
                key={permission.code}
                className={`flex cursor-pointer gap-2 rounded-xl border px-2.5 py-2 transition ${
                  checked
                    ? "border-blue-400/30 bg-blue-500/10"
                    : "border-slate-700 bg-slate-900/75 hover:border-slate-500"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(permission.code)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 accent-blue-500"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-slate-100">{permission.code}</span>
                  {permission.description ? (
                    <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-slate-400">{permission.description}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

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

  const selectedRole = useMemo(
    () => availableRoles.find((role) => String(role.recruiterRoleId) === recruiterRoleId),
    [availableRoles, recruiterRoleId]
  );

  function handleRoleChange(value) {
    const role = availableRoles.find((item) => String(item.recruiterRoleId) === value);
    setRecruiterRoleId(value);
    setSelectedPermissions(getPermissionCodes(role?.permissions));
  }

  function togglePermission(permissionCode) {
    setSelectedPermissions((current) => (
      current.includes(permissionCode)
        ? current.filter((permission) => permission !== permissionCode)
        : [...current, permissionCode].sort()
    ));
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/75 px-3 py-4 backdrop-blur-sm sm:px-4" role="dialog" aria-modal="true">
      <div className="hv-theme-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-[linear-gradient(180deg,#0f172a,#0a1222)] shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
        <div className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-blue-300/80">Team Provisioning</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Add User</h2>
            <p className="mt-2 text-sm text-slate-400">
              Invite a recruiter into this organization and assign an organization role. Permissions are inherited automatically from that role.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
        <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-slate-400">Full Name</label>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-blue-400/40"
              placeholder="Enter full name"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-slate-400">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-blue-400/40"
              placeholder="user@company.com"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-sm text-slate-400">Organization Role</label>
          <select
            value={recruiterRoleId}
            onChange={(event) => handleRoleChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-blue-400/40"
          >
            <option value="">Select role</option>
            {availableRoles.map((role) => (
              <option key={role.recruiterRoleId} value={role.recruiterRoleId}>
                {getRoleDisplayName(role)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/35 p-3 sm:p-4">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Role Default</p>
          {!selectedRole ? (
            <p className="mt-3 text-sm text-slate-400">Select a role to preview the permission set.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${getOrgRoleTone(selectedRole.code)}`}>
                  {getRoleDisplayName(selectedRole)}
                </span>
              </div>
              {selectedRole.description ? (
                <p className="mt-3 text-sm text-slate-400">{selectedRole.description}</p>
              ) : null}
              <p className="mt-3 text-sm text-slate-400">
                {selectedRole.permissions.length} default permissions selected. Adjust the exact access below.
              </p>
            </>
          )}
        </div>

        <PermissionSelector
          allPermissions={allPermissions}
          selectedPermissions={selectedPermissions}
          onToggle={togglePermission}
          onSelectAll={() => setSelectedPermissions(getPermissionCodes(allPermissions))}
          onClear={() => setSelectedPermissions([])}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-3 border-t border-slate-800/80 bg-slate-950/70 px-5 py-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit({ fullName, email, recruiterRoleId, permissionCodes: selectedPermissions })}
            className="hv-solid-action rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Saving..." : "Add User"}
          </button>
        </div>
      </div>
    </div>
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

  const selectedRole = useMemo(
    () => availableRoles.find((role) => String(role.recruiterRoleId) === recruiterRoleId),
    [availableRoles, recruiterRoleId]
  );

  function handleRoleChange(value) {
    const role = availableRoles.find((item) => String(item.recruiterRoleId) === value);
    setRecruiterRoleId(value);
    setSelectedPermissions(getPermissionCodes(role?.permissions));
  }

  function togglePermission(permissionCode) {
    setSelectedPermissions((current) => (
      current.includes(permissionCode)
        ? current.filter((permission) => permission !== permissionCode)
        : [...current, permissionCode].sort()
    ));
  }

  if (!isOpen || !member) {
    return null;
  }

  return (
    <div className="hv-theme-dialog-backdrop fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/75 px-3 py-4 backdrop-blur-sm sm:px-4" role="dialog" aria-modal="true">
      <div className="hv-theme-modal flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-[linear-gradient(180deg,#0f172a,#0a1222)] shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
        <div className="shrink-0 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-blue-300/80">Team Access</p>
            <h2 className="mt-3 text-2xl font-semibold text-white">Edit Team Member</h2>
            <p className="mt-2 text-sm text-slate-400">
              Update the organization role and access state for this recruiter workspace member.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
          <p className="text-lg font-semibold text-white">{member.name}</p>
          <p className="mt-1 text-sm text-slate-400">{member.email}</p>
        </div>

        <div className="mt-4">
          <label className="mb-2 block text-sm text-slate-400">Organization Role</label>
          <select
            value={recruiterRoleId}
            onChange={(event) => handleRoleChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-white outline-none transition focus:border-blue-400/40"
          >
            <option value="">Select role</option>
            {availableRoles.map((role) => (
              <option key={role.recruiterRoleId} value={role.recruiterRoleId}>
                {getRoleDisplayName(role)}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Workspace Status</p>
              <p className="mt-1 text-sm text-slate-400">
                Toggle whether this recruiter can actively access the workspace.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((value) => !value)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                isActive
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-700 bg-slate-900/70 text-slate-300"
              }`}
            >
              {isActive ? "Active" : "Inactive"}
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/35 p-3 sm:p-4">
          <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Role Default</p>
          {!selectedRole ? (
            <p className="mt-3 text-sm text-slate-400">Select a role to preview the permission set.</p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] ${getOrgRoleTone(selectedRole.code)}`}>
                  {getRoleDisplayName(selectedRole)}
                </span>
              </div>
              {selectedRole.description ? (
                <p className="mt-3 text-sm text-slate-400">{selectedRole.description}</p>
              ) : null}
              <p className="mt-3 text-sm text-slate-400">
                {selectedRole.permissions.length} default permissions. Adjust this member&apos;s exact access below.
              </p>
            </>
          )}
        </div>

        <PermissionSelector
          allPermissions={allPermissions}
          selectedPermissions={selectedPermissions}
          onToggle={togglePermission}
          onSelectAll={() => setSelectedPermissions(getPermissionCodes(allPermissions))}
          onClear={() => setSelectedPermissions([])}
        />

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        ) : null}
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-3 border-t border-slate-800/80 bg-slate-950/70 px-5 py-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => onSubmit({ userId: member.userId, recruiterRoleId, isActive, permissionCodes: selectedPermissions })}
            className="hv-solid-action rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white sm:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-8 shadow-[0_14px_44px_rgba(2,6,23,0.22)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <BackToDashboardLink className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-slate-700 bg-slate-950/35 px-4 py-2 text-sm text-slate-200 transition hover:border-blue-400/30 hover:bg-slate-900 hover:text-white" />

              <p className="mt-6 text-xs uppercase tracking-[0.35em] text-blue-300/80">
                Recruiter Administration
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                Manage Team
              </h1>
              <p className="mt-4 max-w-3xl text-base text-slate-300">
                Review organization roles, recruiter membership, and permission scopes seeded for your workspace.
              </p>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/35 px-5 py-4 text-right">
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Organization</p>
                <p className="mt-2 text-sm font-medium text-slate-300" aria-live="polite">
                  {data?.organization || "Workspace"}
                </p>
              </div>
              {canManageUsers ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubmitError("");
                    setIsModalOpen(true);
                  }}
                  className="rounded-xl border border-blue-400/30 bg-blue-500/10 px-5 py-2.5 text-sm font-medium text-blue-100 transition hover:bg-blue-500/20"
                >
                  Add User
                </button>
              ) : null}
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
              <p className="text-sm text-slate-400">Total Team Members</p>
              <p className="mt-3 text-4xl font-semibold text-white">{summary.totalMembers}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
              <p className="text-sm text-slate-400">Active Members</p>
              <p className="mt-3 text-4xl font-semibold text-emerald-300">{summary.activeMembers}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
              <p className="text-sm text-slate-400">Recruiters</p>
              <p className="mt-3 text-4xl font-semibold text-cyan-300">{summary.recruiters}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-5">
              <p className="text-sm text-slate-400">Global Admins</p>
              <p className="mt-3 text-4xl font-semibold text-amber-300">{summary.admins}</p>
            </div>
          </div>

          {notice ? (
            <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-200">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-8 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-5 py-4 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="mt-8 overflow-x-auto overflow-y-hidden rounded-[24px] border border-slate-800 bg-slate-950/30">
            <div className="min-w-[1180px]">
            <div className="hidden grid-cols-[250px_190px_112px_96px_minmax(300px,1fr)_160px] items-start gap-5 border-b border-slate-800 px-6 py-4 text-xs uppercase tracking-[0.18em] text-slate-500 xl:grid">
              <div>Team Member</div>
              <div>Organization Role</div>
              <div>Status</div>
              <div>Joined</div>
              <div>Permissions</div>
              <div>Actions</div>
            </div>

            {team.length === 0 ? (
              <div className="px-6 py-10 text-sm text-slate-400">No recruiter-side team members found for this organization.</div>
            ) : (
              team.map((member) => (
                <div
                  key={member.userId}
                  className="grid min-w-0 grid-cols-1 items-start gap-5 border-b border-slate-900 px-4 py-5 last:border-b-0 sm:px-6 lg:grid-cols-2 xl:grid-cols-[250px_190px_112px_96px_minmax(300px,1fr)_160px]"
                >
                  <div className="min-w-0 self-start">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold text-white">{member.name}</p>
                      {member.isCurrentUser ? (
                        <span className="rounded-full border border-blue-400/20 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.16em] text-blue-200">
                          You
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-400">{member.email}</p>
                    <div className="mt-3 flex min-w-0">
                      <span className={`inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.13em] ${getPlatformRoleTone(member.platformRole)}`}>
                        Platform: {member.platformRole}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 self-start">
                    <span className={`inline-flex max-w-full items-center justify-center whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${getOrgRoleTone(member.isAdmin ? "Admin" : member.organizationRoleCode)}`}>
                      {getMemberRoleLabel(member)}
                    </span>
                    {member.organizationRoleDescription ? (
                      <p className="mt-2 max-w-[220px] text-sm leading-5 text-slate-400">{member.organizationRoleDescription}</p>
                    ) : (
                      <p className="mt-2 text-sm leading-5 text-slate-500">No role profile assigned</p>
                    )}
                  </div>

                  <div className="self-start">
                    <div className="flex flex-col items-start gap-2">
                      <span className={`inline-flex min-w-[96px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                        member.isActive
                          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                          : "border-slate-700 bg-slate-900/80 text-slate-400"
                      }`}>
                        {member.isActive ? "Active" : "Inactive"}
                      </span>
                      <span className={`inline-flex min-w-[96px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getInviteStatusTone(member.inviteStatus)}`}>
                        {member.inviteStatus || "Accepted"}
                      </span>
                    </div>
                  </div>

                  <div className="self-start whitespace-nowrap text-sm text-slate-300">{formatDate(member.joinedAt)}</div>

                  <div className="grid content-start grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-2">
                    {member.permissions.length === 0 ? (
                      <span className="text-sm text-slate-500">No permissions mapped</span>
                    ) : (
                      member.permissions.map((permission) => (
                        <div
                          key={`${member.userId}-${permission.code}`}
                          className="rounded-xl border border-slate-700 bg-slate-900/75 px-2.5 py-2"
                        >
                          <p className="truncate text-xs font-medium text-slate-100">{permission.code}</p>
                          {permission.description ? (
                            <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">{permission.description}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="grid w-40 min-w-40 content-start gap-2">
                    {canManageUsers && !member.isCurrentUser ? (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditModal(member)}
                          className="w-full rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:border-blue-400/30 hover:text-white"
                        >
                          Edit Access
                        </button>
                        <button
                          type="button"
                          disabled={rowActionUserId === member.userId}
                          onClick={() => handleResendInvite(member)}
                          className="w-full rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {rowActionUserId === member.userId && rowActionType === "resend" ? "Sending..." : "Resend Access"}
                        </button>
                        <button
                          type="button"
                          disabled={rowActionUserId === member.userId}
                          onClick={() => handleMemberAccessAction(member, member.isActive ? "disable-member" : "enable-member")}
                          className={[
                            "w-full rounded-xl border px-3 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-60",
                            member.isActive
                              ? "border-amber-400/25 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                              : "border-emerald-400/25 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
                          ].join(" ")}
                        >
                          {rowActionUserId === member.userId && rowActionType !== "remove-member" && rowActionType !== "resend"
                            ? "Updating..."
                            : member.isActive
                              ? "Disable"
                              : "Enable"}
                        </button>
                        <button
                          type="button"
                          disabled={rowActionUserId === member.userId}
                          onClick={() => handleMemberAccessAction(member, "remove-member")}
                          className="w-full rounded-xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {rowActionUserId === member.userId && rowActionType === "remove-member" ? "Removing..." : "Delete"}
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-slate-500">No actions</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
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
