import { getAdminClient } from "@/lib/authServer";

const settingsRowId = true;

type SiteSettingsRow = {
  maintenance_mode?: boolean | null;
};

export const getMaintenanceMode = async (): Promise<boolean> => {
  const adminClient = getAdminClient();
  const { data } = await adminClient
    .from("site_settings")
    .select("maintenance_mode")
    .eq("id", settingsRowId)
    .maybeSingle();

  const row = data as SiteSettingsRow | null;
  return row?.maintenance_mode === true;
};

export const setMaintenanceMode = async (
  enabled: boolean,
  updatedBy?: string | null
) => {
  const adminClient = getAdminClient();
  const { error } = await adminClient.from("site_settings").upsert({
    id: settingsRowId,
    maintenance_mode: enabled,
    updated_by: updatedBy ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message ?? "Failed to update maintenance mode.");
  }
};
