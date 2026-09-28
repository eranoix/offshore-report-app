export const TICKETS = [
  "BOSIET",
  "CA-EBS",
  "ENG1 medical",
  "FOET",
  "HUET",
  "IMCA ROV Pilot Technician",
  "IMCA ROV Supervisor",
  "MIST",
  "Offshore medical",
  "Rigging and slinging",
  "Seafarer's medical",
  "Working at height",
  "Yellow fever",
];

export const BLANK_CERT = { id: "", what: "", body: "", issued: "", expires: "", note: "" };

const SOON = 90;

export function standing(cert, todayIso) {
  if (!cert?.expires) return "ok";
  const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
  const left = day(cert.expires) - day(todayIso);
  if (left < 0) return "gone";
  return left <= SOON ? "soon" : "ok";
}
