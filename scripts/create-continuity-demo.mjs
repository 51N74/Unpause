// Creates owner-authored demo context in an existing account; never logs credentials.
const base = process.env.UNPAUSE_BASE_URL || 'http://localhost:4000/api/v1';
const email = process.env.UNPAUSE_EMAIL;
const password = process.env.UNPAUSE_PASSWORD;
if (!email || !password) throw new Error('Set UNPAUSE_EMAIL and UNPAUSE_PASSWORD for your existing account');
const parsed = new URL(base);
if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Use HTTPS for remote servers');
let cookie = '';
async function call(path, data) {
  const response = await fetch(base + path, {method: 'POST', redirect: 'error', headers: {'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {})}, body: JSON.stringify(data)});
  if (!response.ok) throw new Error(`Demo setup failed at ${path}: HTTP ${response.status}`);
  if (path === '/auth/login') cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  return response.json();
}
await call('/auth/login', {email, password});
const {project} = await call('/projects', {
  name: 'GitHub Continuity Demo', description: 'Return to a small project with code activity, rationale and next action together.',
  initialScope: {problem: 'Losing context after time away', targetUsers: 'Solo developers', goal: 'Know what changed, why and what comes next', inScope: 'One public repository and its default branch', outOfScope: 'Private repositories, AI interpretation and automatic issue closure'},
});
const {issue} = await call(`/projects/${project.id}/issues`, {title: 'Verify expired sessions', nextAction: 'Sign in, expire the test session, then confirm protected requests return 401.', priority: 'High'});
const {decision} = await call(`/projects/${project.id}/decisions`, {problem: 'Keep the course deployment simple', decision: 'Use server-side cookie sessions', rationale: 'Revocation stays on the server and browser JavaScript cannot read the HttpOnly cookie.', scopeImpact: 'None', issueId: issue.id});
async function update(path, method, body) {
  const response = await fetch(base + path, {method, redirect: 'error', headers: {'Content-Type': 'application/json', Cookie: cookie}, body: JSON.stringify(body)});
  if (!response.ok) throw new Error(`Demo setup failed at ${path}: HTTP ${response.status}`);
}
await update(`/projects/${project.id}/decisions/${decision.id}/pin`, 'PATCH', {isPinned: true});
await update(`/projects/${project.id}/return-context`, 'PUT', {returnNote: 'Authentication works locally. Next, test expired sessions. We chose cookie sessions to keep deployment simple.', focusIssueId: issue.id});
console.log(`Demo ready: /projects/${project.id}/resume`);
console.log('Connect your own small public repository in the Resume page, then configure the downloaded workflow.');
