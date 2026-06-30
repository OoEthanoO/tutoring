-- Stores the set of website-linked Discord members observed during the previous
-- Discord sync run, as a JSON object of { [discordUserId]: discordUsername }.
-- Used to detect members joining/leaving the server between sync runs so the COO
-- can be pinged in the founders channel.
ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS discord_member_snapshot JSONB;
