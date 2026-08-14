"use client";

async function readLiveOrganizationId() {
  try {
    const response = await fetch("/api/me", {
      credentials: "include",
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.success) {
      return null;
    }

    const organizationId = payload?.data?.organizationId;
    return typeof organizationId === "string" && organizationId.trim()
      ? organizationId.trim()
      : null;
  } catch {
    return null;
  }
}

export async function openWarRoom(orgIdOverride) {
  const pendingWindow = window.open("about:blank", "_blank");

  if (pendingWindow) {
    pendingWindow.opener = null;
  }
  let organizationId =
    typeof orgIdOverride === "string" && orgIdOverride.trim()
      ? orgIdOverride.trim()
      : null;

  if (!organizationId) {
    organizationId = await readLiveOrganizationId();
  }

  if (!organizationId) {
    if (pendingWindow && !pendingWindow.closed) {
      pendingWindow.close();
    }

    window.alert("Unable to open War Room because the live organization context could not be resolved.");
    return false;
  }

  const launchUrl = new URL("/api/war-room/launch", window.location.origin);
  launchUrl.searchParams.set("orgId", organizationId);

  const currentTheme = document.documentElement.dataset.theme;
  if (currentTheme === "light" || currentTheme === "dark") {
    launchUrl.searchParams.set("theme", currentTheme);
  }

  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.href = launchUrl.toString();
  } else {
    window.open(launchUrl.toString(), "_blank", "noopener,noreferrer");
  }

  return true;
}
