import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { continuityApi } from '../api/continuity';
import { extractApiError } from '../api/client';
import { formatBangkokDateTime } from '../utils/date';
import workflowTemplate from '../../../../docs/templates/unpause-github.yml?raw';

type Props = { projectId: string; archived: boolean; issues: {id: string; title: string; nextAction: string}[] };
export const GitHubContinuity: React.FC<Props> = ({projectId, archived, issues}) => {
  const cache = useQueryClient();
  const key = ['project', projectId, 'github'];
  const query = useQuery({queryKey: key, queryFn: () => continuityApi.view(projectId), refetchInterval: () => !archived && document.visibilityState === 'visible' ? 20000 : false, refetchIntervalInBackground: false, refetchOnWindowFocus: true});
  const [url, setUrl] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const attempted = useRef<string | null>(null);
  const data = query.data;
  const connection = data?.connection;
  const selectableIssues = data?.focusIssue && !issues.some(i => i.id === data.focusIssue?.id) ? [data.focusIssue, ...issues] : issues;
  const chosenIssue = data?.focusIssue ?? issues.find(i => i.id === data?.focusIssueId);
  async function act(task: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await task(); await cache.invalidateQueries({queryKey: key}); }
    catch (err) { setError(extractApiError(err).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!archived && connection && attempted.current !== connection.id) {
      attempted.current = connection.id;
      void act(() => continuityApi.sync(projectId, false));
    }
  }, [connection?.id, archived, projectId]); // One stale catch-up on entry, separate from display polling.
  function downloadWorkflow() {
    if (!connection) return;
    const blob = new Blob([workflowTemplate.replace('__BRANCH_JSON__', JSON.stringify(connection.branch))], {type: 'text/yaml'});
    const href = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = href; a.download = 'unpause.yml'; a.click(); URL.revokeObjectURL(href);
  }
  const endpoint = connection ? `${new URL(apiClientBase(), window.location.origin).href.replace(/\/$/, '')}/integrations/github/${connection.id}/deliveries` : '';
  if (query.isLoading) return <Paper sx={{p: 3, mb: 3}}>Loading GitHub context…</Paper>;
  if (!data) return <Alert severity="warning" sx={{mb: 3}}>GitHub context unavailable. Saved Scope, Decisions and next actions remain below. <Button onClick={() => void query.refetch()}>Retry</Button></Alert>;
  return <Paper variant="outlined" sx={{p: 3, mb: 3}}>
    <Stack spacing={2}>
      <Typography variant="h6">Continue here</Typography>
      {editing ? <>
        <TextField label="Return note" multiline minRows={2} value={note ?? data.returnNote} inputProps={{maxLength: 5000}} onChange={e => setNote(e.target.value)} />
        <TextField select label="Focus next action" value={focus ?? ''} onChange={e => setFocus(e.target.value)}>
          <MenuItem value="">No focus issue</MenuItem>
          {selectableIssues.map(i => <MenuItem key={i.id} value={i.id}>{i.title}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1}><Button disabled={busy || archived} onClick={() => void act(async () => {await continuityApi.saveContext(projectId, note ?? data.returnNote, focus || null); setEditing(false); setNote(null);})}>Save return context</Button><Button onClick={() => {setEditing(false);setNote(null);}}>Cancel</Button></Stack>
      </> : <>
        <Typography sx={{whiteSpace: 'pre-wrap'}}>{data.returnNote || 'Leave an optional note for your next work session.'}</Typography>
        {chosenIssue && <Typography><strong>Next action:</strong> {chosenIssue.nextAction}</Typography>}
        {!archived && <Button sx={{alignSelf: 'start'}} onClick={() => {setEditing(true);setFocus(data.focusIssueId);}}>Edit return context</Button>}
      </>}
      <Typography variant="h6">Changes since your last review</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {query.isError && <Alert severity="warning">Refresh failed; showing cached activity.</Alert>}
      {!connection ? <>
        <Chip label="Not connected" sx={{alignSelf: 'start'}} />
        {!archived && <><TextField label="Public GitHub repository URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/owner/repo" /><Button disabled={busy || !url} onClick={() => void act(async () => {const r = await continuityApi.connect(projectId, url); setSecret(r.secret);})}>Connect GitHub repository</Button></>}
      </> : <>
        <Stack direction="row" spacing={1} flexWrap="wrap"><Chip label={connection.state} /><Chip label={`${connection.fullName} · ${connection.branch} only`} /><Chip label={`${data.unread} unread updates`} /></Stack>
        <Typography variant="body2">Last delivery received: {connection.lastDeliveryReceivedAt ? formatBangkokDateTime(connection.lastDeliveryReceivedAt) : 'Not confirmed — workflow setup required'}</Typography>
        <Typography variant="body2">Last successful synchronization: {connection.lastSyncedAt ? formatBangkokDateTime(connection.lastSyncedAt) : 'Never'}. Development activity: {connection.lastGitActivityAt ? formatBangkokDateTime(connection.lastGitActivityAt) : 'None'}</Typography>
        {connection.incompleteHistory && <Alert severity="warning">History may be incomplete because the recovery window was exceeded or history was rewritten. This list is not a complete code diff.</Alert>}
        {!archived && <Stack direction="row" spacing={1} flexWrap="wrap">
          <Button disabled={busy} onClick={() => void act(() => continuityApi.sync(projectId, true))}>Sync / retry</Button>
          <Button disabled={busy || !data.unread} onClick={() => void act(() => continuityApi.review(projectId, connection.id, connection.sequence))}>Mark updates as reviewed</Button>
          <Button onClick={downloadWorkflow}>Download workflow</Button>
          <Button disabled={busy} onClick={() => void act(async () => {setSecret((await continuityApi.rotate(projectId)).secret);})}>Rotate secret</Button>
          <Button color="error" disabled={busy} onClick={() => setUnlinkOpen(true)}>Unlink</Button>
        </Stack>}
        <Accordion defaultExpanded={!connection.lastDeliveryReceivedAt} disableGutters elevation={0} sx={{border: '1px solid', borderColor: 'divider'}}>
          <AccordionSummary><Typography>Workflow setup instructions</Typography></AccordionSummary>
          <AccordionDetails>
        <Typography variant="body2">Setup: add the downloaded file as <code>.github/workflows/unpause.yml</code> in this repository. Add repository variable <code>UNPAUSE_DELIVERY_URL</code> with the endpoint below and repository secret <code>UNPAUSE_SECRET</code>. Push to {connection.branch}. Linking or API recovery does not confirm automatic delivery.</Typography>
        <TextField label="Delivery endpoint (requires HTTPS in GitHub)" value={endpoint} fullWidth slotProps={{input: {readOnly: true}}} sx={{mt: 2}} />
          </AccordionDetails>
        </Accordion>
        {data.activity.length === 0 && <Typography>No received changes yet.</Typography>}
        {data.activity.map(a => <Box key={a.deliveryId} sx={{borderTop: '1px solid', borderColor: 'divider', pt: 1}}>
          <Typography variant="subtitle2">{a.source === 'actions' ? 'Push' : 'Recovered activity'} · {a.commits.length} {a.commits.length === 1 ? 'commit' : 'commits'} {a.sequence > connection.reviewedSequence ? '· Unread' : ''}</Typography>
          <Typography variant="caption">Event: {formatBangkokDateTime(a.eventAt)} · Received: {formatBangkokDateTime(a.receivedAt)}</Typography>
          {a.commits.map(c => <Typography variant="body2" key={c.sha} sx={{overflowWrap: 'anywhere'}}><Link href={`https://github.com/${connection.fullName}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">{c.sha.slice(0, 7)}</Link> {c.message.split('\n')[0]} — {c.author} · {formatBangkokDateTime(c.eventAt)}</Typography>)}
        </Box>)}
        <Typography variant="caption">Latest 20 groups, up to 100 commits per delivery. Unread count includes older groups. Refreshes about every 20 seconds while visible; page refresh never marks updates as reviewed.</Typography>
      </>}
    </Stack>
    <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} fullWidth><DialogTitle>Save your connection secret now</DialogTitle><DialogContent><Typography>This secret is shown once. Store it as the GitHub Actions repository secret UNPAUSE_SECRET. Rotating invalidates the previous secret immediately.</Typography><TextField label="UNPAUSE_SECRET" fullWidth value={secret ?? ''} slotProps={{input: {readOnly: true}}} sx={{mt: 2}} /></DialogContent><DialogActions><Button onClick={() => setSecret(null)}>Done</Button></DialogActions></Dialog>
    <Dialog open={unlinkOpen} onClose={() => setUnlinkOpen(false)}><DialogTitle>Unlink repository?</DialogTitle><DialogContent>The credential, cached GitHub activity and review state will be deleted. Your return note, Scope, Decisions and Issues remain saved.</DialogContent><DialogActions><Button onClick={() => setUnlinkOpen(false)}>Cancel</Button><Button color="error" disabled={busy} onClick={() => void act(async () => {await continuityApi.unlink(projectId);setSecret(null);setUnlinkOpen(false);})}>Unlink repository</Button></DialogActions></Dialog>
  </Paper>;
};
function apiClientBase() { return import.meta.env.VITE_API_BASE_URL || '/api/v1'; }
