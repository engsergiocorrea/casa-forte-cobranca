function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function keyToEpochDay(key: string) {
  const [y,m,d] = key.split("-").map(Number);
  return Date.UTC(y,m-1,d) / 86400000;
}
export function daysFromDue(today: Date, due: Date, timeZone = "America/Maceio") {
  return Math.round(keyToEpochDay(localDateKey(today, timeZone)) - keyToEpochDay(localDateKey(due, timeZone)));
}
