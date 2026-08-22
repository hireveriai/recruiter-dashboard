"use client";

import { useEffect, useRef } from "react";

import { logoutRecruiter } from "@/lib/client/logout";

const INACTIVITY_LIMIT_MS = 4 * 60 * 60 * 1000;
const STORAGE_KEY = "verisnova:last-activity-at";

function hasSessionCookie() {
  return document.cookie.split(";").some((entry) => {
    const name = entry.trim().split("=")[0];
    return name === "hireveri_session" || (name.startsWith("sb-") && name.includes("-auth-token"));
  });
}

function readLastActivity() {
  const value = window.localStorage.getItem(STORAGE_KEY);
  const timestamp = Number(value);

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  return timestamp;
}

function writeLastActivity(timestamp) {
  window.localStorage.setItem(STORAGE_KEY, String(timestamp));
}

export default function SessionInactivityGuard() {
  const loggingOutRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    function performLogout() {
      if (loggingOutRef.current) {
        return;
      }

      loggingOutRef.current = true;
      window.localStorage.removeItem(STORAGE_KEY);
      logoutRecruiter();
    }

    function markActivity() {
      if (!hasSessionCookie()) {
        return;
      }

      writeLastActivity(Date.now());
    }

    function validateTimeout() {
      if (!hasSessionCookie()) {
        return;
      }

      const lastActivity = readLastActivity();

      if (!lastActivity) {
        writeLastActivity(Date.now());
        return;
      }

      if (Date.now() - lastActivity >= INACTIVITY_LIMIT_MS) {
        performLogout();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        validateTimeout();
      }
    }

    validateTimeout();
    markActivity();

    const activityEvents = ["mousedown", "keydown", "click", "scroll", "touchstart"];

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });

    window.addEventListener("focus", validateTimeout);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = window.setInterval(validateTimeout, 60 * 1000);

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });

      window.removeEventListener("focus", validateTimeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
