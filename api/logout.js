import { clearSession } from './_session.js';

export default function handler(req, res) {
  clearSession(res);
  res.redirect(302, '/');
}
