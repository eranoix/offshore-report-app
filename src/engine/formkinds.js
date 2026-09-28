export const FORM_KINDS = ["witness", "observation", "knowledge", "feedback", "trip", "sed"];
export const FORM_NAMES = {
  witness: "Witness testimony",
  observation: "Observation report",
  knowledge: "Knowledge questions",
  feedback: "Assessor feedback",
  trip: "Trip feedback",
  sed: "Days at sea",
};

export const SHEET_KINDS = ["sed"];
export const isSheet = (kind) => SHEET_KINDS.includes(String(kind || ""));

export const extOf = (kind) => (isSheet(kind) ? "xlsx" : "docx");
