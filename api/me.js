import { countRows, isAdmin, requireSession } from "./_supabase.js";

export default async function handler(req, res) {
  const who = requireSession(req, res);
  if (!who) return;

  const me = {
    id: who.sub,
    email: who.email,
    admin: isAdmin(who),
  };

  if (req.query?.counts !== "1") return res.status(200).json(me);

  try {
    const count = (table) => countRows(`${table}?user_id=eq.${who.sub}&select=user_id`);
    const [documents, phrases] = await Promise.all([count("offshore_report_documents"), count("offshore_report_phrases")]);
    return res.status(200).json({ ...me, documents, phrases });
  } catch (e) {
    return res.status(200).json({ ...me, documents: null, phrases: null, trouble: e.message });
  }
}
