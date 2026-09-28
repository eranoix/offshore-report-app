const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export const byName = (a, b) => collator.compare(String(a ?? ""), String(b ?? ""));

export const inOrder = (list, of = (x) => x) =>
  [...(list || [])].sort((a, b) => byName(of(a), of(b)));
