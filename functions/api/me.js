import { json } from '../../lib/http.js';

/* Who is signed in. Reachable only through the gate, so by the time this runs
 * the middleware has already put a verified session on context.data. */
export async function onRequestGet(context) {
  const user = context.data && context.data.user;
  if (!user) return json({ error: 'Not signed in.' }, { status: 401 });
  return json({ email: user.email || null });
}
