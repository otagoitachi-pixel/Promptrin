// In-memory fake of the GitHub Git Data API, used by the Worker tests and the browser test.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.mjs';

export function fakeGitHub() {
  const blobs = new Map(); // sha -> Buffer
  const trees = new Map(); // sha -> Map(path -> sha)
  const commits = new Map(); // sha -> {tree, message}
  const sha = (b) => crypto.createHash('sha1').update(b).digest('hex');
  const putBlob = (buf) => { const s = sha(Buffer.concat([Buffer.from('blob '), buf])); blobs.set(s, buf); return s; };
  const files = new Map();
  const walk = (dir) => { for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) { const rel = `${dir}/${f.name}`; if (f.isDirectory()) walk(rel); else files.set(rel, putBlob(fs.readFileSync(path.join(ROOT, rel)))); } };
  for (const d of ['data/prompts', 'content/guides']) walk(d);
  files.set('images/originals/placeholder-a.jpg', putBlob(Buffer.from('x')));
  const putTree = (m) => { const s = sha(Buffer.from(JSON.stringify([...m].sort()))); trees.set(s, new Map(m)); return s; };
  const putCommit = (tree, message) => { const s = sha(Buffer.from(tree + message + Math.random())); commits.set(s, { tree, message }); return s; };
  let head = putCommit(putTree(files), 'initial');
  const state = { calls: 0, failCommitOnce: false, onBeforeRef: null };
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  async function fetchImpl(url, opts = {}) {
    state.calls++;
    const u = new URL(url);
    assert.equal(u.host, 'api.github.com');
    assert.equal(opts.headers.Authorization, 'Bearer ghp_fake');
    const p = u.pathname.replace('/repos/me/promptrin', '');
    const body = opts.body ? JSON.parse(opts.body) : null;
    const m = opts.method || 'GET';
    if (m === 'GET' && p === '/git/ref/heads/main') return json({ object: { sha: head } });
    let r;
    if ((r = /^\/git\/commits\/(\w+)$/.exec(p)) && m === 'GET') { const c = commits.get(r[1]); return json({ tree: { sha: c.tree }, message: c.message, committer: { date: '2026-11-01T00:00:00Z' } }); }
    if ((r = /^\/git\/trees\/(\w+)$/.exec(p)) && m === 'GET') return json({ truncated: false, tree: [...trees.get(r[1])].map(([path, sha]) => ({ path, sha, type: 'blob' })) });
    if ((r = /^\/git\/blobs\/(\w+)$/.exec(p)) && m === 'GET') return new Response(blobs.get(r[1]));
    if (p === '/git/blobs' && m === 'POST') return json({ sha: putBlob(Buffer.from(body.content, 'base64')) }, 201);
    if (p === '/git/trees' && m === 'POST') {
      const t = new Map(trees.get(body.base_tree));
      for (const e of body.tree) { if (e.sha === null) t.delete(e.path); else if (e.content !== undefined) t.set(e.path, putBlob(Buffer.from(e.content))); else { assert.ok(blobs.has(e.sha), 'tree references unknown blob'); t.set(e.path, e.sha); } }
      return json({ sha: putTree(t) }, 201);
    }
    if (p === '/git/commits' && m === 'POST') { assert.equal(body.parents.length, 1); return json({ sha: putCommit(body.tree, body.message) }, 201); }
    if (p === '/git/refs/heads/main' && m === 'PATCH') {
      state.onBeforeRef?.();
      const c = commits.get(body.sha);
      if (state.failCommitOnce || body.sha === head) { state.failCommitOnce = false; return new Response('{"message":"Update is not a fast forward"}', { status: 422 }); }
      head = body.sha; void c; return json({});
    }
    return json({ message: 'nope' }, 404);
  }
  const read = (p) => { const t = trees.get(commits.get(head).tree); return t.has(p) ? blobs.get(t.get(p)) : null; };
  const paths = () => [...trees.get(commits.get(head).tree).keys()];
  return { fetchImpl, state, read, paths, get head() { return head; }, moveHead: () => { head = putCommit(commits.get(head).tree, 'someone else'); } };
}

