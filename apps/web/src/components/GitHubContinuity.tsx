import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { continuityApi } from '../api/continuity';
import { extractApiError } from '../api/client';
import { formatBangkokDateTime } from '../utils/date';
import { CommitActivity } from './CommitActivity';
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
  const [reviewSnapshot, setReviewSnapshot] = useState<{id: string; sequence: number} | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [progress, setProgress] = useState('');
  const [blocker, setBlocker] = useState('');
  const [next, setNext] = useState('');
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [pauseSaved, setPauseSaved] = useState(false);
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
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="h6">Continue here</Typography>{!archived&&<Button variant="outlined" onClick={()=>{setPauseOpen(true);setPauseError(null);setPauseSaved(false);}}>Pause work</Button>}</Stack>
      {pauseSaved&&<Alert severity="success">Pause note saved. You can return to it next time.</Alert>}
      {editing ? <>
        <TextField label="Return note" multiline minRows={2} value={note ?? data.returnNote} inputProps={{maxLength: 5000}} onChange={e => setNote(e.target.value)} />
        <TextField select label="Focus next action" value={focus ?? ''} onChange={e => setFocus(e.target.value)}>
          <MenuItem value="">No focus issue</MenuItem>
          {selectableIssues.map(i => <MenuItem key={i.id} value={i.id}>{i.title}</MenuItem>)}
        </TextField>
        <Stack direction="row" spacing={1}><Button disabled={busy || archived} onClick={() => void act(async () => {await continuityApi.saveContext(projectId, note ?? data.returnNote, focus || null); setEditing(false); setNote(null);})}>Save return context</Button><Button onClick={() => {setEditing(false);setNote(null);}}>Cancel</Button></Stack>
      </> : <>
        <Typography sx={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{data.returnNote || 'Leave an optional note for your next work session.'}</Typography>
        {chosenIssue && <Typography><strong>Focus issue next action:</strong> {chosenIssue.nextAction}</Typography>}
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
          <Button disabled={busy || !data.unread} onClick={() => setReviewSnapshot({id:connection.id,sequence:connection.sequence})}>Mark all updates as reviewed</Button>
        </Stack>}
        <Accordion defaultExpanded={!connection.lastDeliveryReceivedAt} disableGutters elevation={0} sx={{border: '1px solid', borderColor: 'divider'}}>
          <AccordionSummary><Typography>Manage connection / workflow setup</Typography></AccordionSummary>
          <AccordionDetails>
        {!archived&&<Stack direction="row" spacing={1} flexWrap="wrap">
          <Button onClick={downloadWorkflow}>Download workflow</Button>
          <Button disabled={busy} onClick={() => void act(async () => {setSecret((await continuityApi.rotate(projectId)).secret);})}>Rotate secret</Button>
          <Button color="error" disabled={busy} onClick={() => setUnlinkOpen(true)}>Unlink</Button>
        </Stack>}
        <Typography variant="body2">Setup: add the downloaded file as <code>.github/workflows/unpause.yml</code> in this repository. Add repository variable <code>UNPAUSE_DELIVERY_URL</code> with the endpoint below and repository secret <code>UNPAUSE_SECRET</code>. Push to {connection.branch}. Linking or API recovery does not confirm automatic delivery.</Typography>
        <TextField label="Delivery endpoint (requires HTTPS in GitHub)" value={endpoint} fullWidth slotProps={{input: {readOnly: true}}} sx={{mt: 2}} />
          </AccordionDetails>
        </Accordion>
        <CommitActivity projectId={projectId} data={data} archived={archived} onSaved={()=>cache.invalidateQueries({queryKey:key})} />
        <Typography variant="caption">Updates refresh about every 20 seconds while visible. Cached history covers up to the latest 20 update groups.</Typography>
      </>}
    </Stack>
    <Dialog open={!!reviewSnapshot} onClose={()=>setReviewSnapshot(null)} fullWidth>
      <DialogTitle>Mark all received updates as reviewed?</DialogTitle>
      <DialogContent>This includes received updates hidden by the five-commit preview and older groups. Updates received after this snapshot stay unread.</DialogContent>
      <DialogActions><Button onClick={()=>setReviewSnapshot(null)}>Cancel</Button><Button disabled={busy||archived} onClick={()=>{if(reviewSnapshot){const {id,sequence}=reviewSnapshot;setReviewSnapshot(null);void act(()=>continuityApi.review(projectId,id,sequence));}}}>Confirm review all</Button></DialogActions>
    </Dialog>
    <Dialog open={pauseOpen} onClose={()=>{if(!busy)setPauseOpen(false);}} fullWidth maxWidth="sm">
      <DialogTitle>Pause work</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{mb:2}}>Save a handoff for your next session. Saving replaces your current return note and keeps your selected focus issue.</Typography>
        {data.returnNote&&<Typography variant="body2" sx={{mb:2,whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>Current note: {data.returnNote}</Typography>}
        {pauseError&&<Alert severity="error">{pauseError}</Alert>}
        <TextField label="Where I stopped" required fullWidth multiline minRows={2} value={progress} onChange={e=>setProgress(e.target.value)} inputProps={{maxLength:1400}} sx={{mb:2}} />
        <TextField label="Blockers (optional)" fullWidth multiline value={blocker} onChange={e=>setBlocker(e.target.value)} inputProps={{maxLength:1400}} sx={{mb:2}} />
        <TextField label="Next action when I return" required fullWidth multiline minRows={2} value={next} onChange={e=>setNext(e.target.value)} inputProps={{maxLength:1400}} />
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={()=>setPauseOpen(false)}>Cancel</Button><Button disabled={busy||archived||!progress.trim()||!next.trim()} onClick={()=>{setBusy(true);setPauseError(null);void continuityApi.saveContext(projectId,`Where I stopped: ${progress.trim()}\nBlockers: ${blocker.trim()||'None recorded'}\nNext action: ${next.trim()}`,data.focusIssueId).then(async()=>{await cache.invalidateQueries({queryKey:key});setPauseOpen(false);setProgress('');setBlocker('');setNext('');setPauseSaved(true);}).catch(e=>setPauseError(extractApiError(e).message)).finally(()=>setBusy(false));}}>Save pause note</Button></DialogActions>
    </Dialog>
    <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} fullWidth><DialogTitle>Save your connection secret now</DialogTitle><DialogContent><Typography>This secret is shown once. Store it as the GitHub Actions repository secret UNPAUSE_SECRET. Rotating invalidates the previous secret immediately.</Typography><TextField label="UNPAUSE_SECRET" fullWidth value={secret ?? ''} slotProps={{input: {readOnly: true}}} sx={{mt: 2}} /></DialogContent><DialogActions><Button onClick={() => setSecret(null)}>Done</Button></DialogActions></Dialog>
    <Dialog open={unlinkOpen} onClose={() => setUnlinkOpen(false)}><DialogTitle>Unlink repository?</DialogTitle><DialogContent>The credential, cached GitHub activity and review state will be deleted. Your return note, Scope, Decisions and Issues remain saved.</DialogContent><DialogActions><Button onClick={() => setUnlinkOpen(false)}>Cancel</Button><Button color="error" disabled={busy} onClick={() => void act(async () => {await continuityApi.unlink(projectId);setSecret(null);setUnlinkOpen(false);})}>Unlink repository</Button></DialogActions></Dialog>
  </Paper>;
};
function apiClientBase() { return import.meta.env.VITE_API_BASE_URL || '/api/v1'; }
