// Discord dynamic timestamp markup — renders in each viewer's local timezone.
// Styles: t short time, T long time, d short date, D long date, f short
// date/time, F long date/time with weekday, R relative ("in 15 minutes").
// https://discord.com/developers/docs/reference#message-formatting-timestamp-styles
export type DiscordTimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

export const formatDiscordTimestamp = (
  value: string | number | Date,
  style: DiscordTimestampStyle = "F"
): string => {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) {
    return String(value);
  }
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
};

// Long date/time plus a live relative suffix, e.g.
// "<t:...:F> (<t:...:R>)" → "Saturday, July 25, 2026 4:00 PM (in 2 hours)".
export const formatDiscordTimestampWithRelative = (
  value: string | number | Date
): string => {
  const absolute = formatDiscordTimestamp(value, "F");
  if (!absolute.startsWith("<t:")) {
    return absolute;
  }
  return `${absolute} (${formatDiscordTimestamp(value, "R")})`;
};
