import { sessionOf } from './_session.js';

export default function handler(req, res) {
  const user = sessionOf(req);
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(user ? { signedIn: true, user: { id: user.id, name: user.name, avatar: user.avatar } } : { signedIn: false });
}
