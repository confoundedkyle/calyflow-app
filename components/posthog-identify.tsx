"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

interface PostHogIdentifyProps {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: string | null;
}

export function PostHogIdentify({
  userId,
  workspaceId,
  workspaceName,
  workspaceType,
}: PostHogIdentifyProps) {
  useEffect(() => {
    posthog.identify(userId, {
      workspace_id: workspaceId,
      workspace_name: workspaceName,
      workspace_type: workspaceType,
    });
  }, [userId, workspaceId, workspaceName, workspaceType]);

  return null;
}
