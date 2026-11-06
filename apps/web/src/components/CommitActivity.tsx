import React, {useState} from 'react';
import {Accordion, AccordionSummary, AccordionDetails, Alert, Box, Button, Dialog, DialogTitle, DialogContent, DialogActions, Link, MenuItem, Stack, TextField, Typography} from '@mui/material';
import {useQuery} from '@tanstack/react-query';
import {continuityApi, type ContinuityView, type GitCommit} from '../api/continuity';
import {issuesApi, decisionsApi} from '../api/endpoints';
import {extractApiError} from '../api/client';
import {formatBangkokDateTime} from '../utils/date';

type Props = {projectId: string; data: ContinuityView; archived: boolean; onSaved: () => Promise<unknown>};
export function CommitActivity({projectId,data,archived,onSaved}: Props) {
  const [limit,setLimit]=useState(5);
  const [selected,setSelected]=useState<GitCommit | null>(null);
  const [issue,setIssue]=useState(''); const [decision,setDecision]=useState('');
  const [search,setSearch]=useState(''); const [decisionSearch,setDecisionSearch]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState<string | null>(null);
  const issueQuery=useQuery({queryKey:['project',projectId,'link-issues',search],queryFn:()=>issuesApi.list(projectId,{search,pageSize:20}),enabled:!!selected});
  const decisionQuery=useQuery({queryKey:['project',projectId,'link-decisions',decisionSearch],queryFn:()=>decisionsApi.list(projectId,{search:decisionSearch}),enabled:!!selected});
  const connection=data.connection;
  if(!connection)return null;
  const commits=data.activity.flatMap(group=>group.commits.map(commit=>({commit,group}))).sort((a,b)=>Date.parse(b.commit.eventAt)-Date.parse(a.commit.eventAt)||b.commit.sha.localeCompare(a.commit.sha));
  const selectedLink=data.links?.find(l=>l.sha===selected?.sha);
  async function save() {
    if(!selected)return;
    setBusy(true);setError(null);
    try {await continuityApi.link(projectId,selected.sha,issue||null,decision||null);await onSaved();setSelected(null);}
    catch(e){setError(extractApiError(e).message);}finally{setBusy(false);}
  }
  return <Stack spacing={1}>
    <Typography variant="subtitle1" fontWeight={700}>Latest commits</Typography>
    {!commits.length&&<Typography>No received changes yet.</Typography>}
    {commits.slice(0,limit).map(({commit:c,group})=>{
      const link=data.links?.find(l=>l.sha===c.sha);
      return <Box key={c.sha} data-testid="commit-row" sx={{borderTop:'1px solid',borderColor:'divider',pt:1,minWidth:0}}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Link href={`https://github.com/${connection.fullName}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer" sx={{flexShrink:0}}>{c.sha.slice(0,7)}</Link>
          <Typography variant="body2" noWrap title={c.message.split('\n')[0]} sx={{minWidth:0}}>{c.message.split('\n')[0]}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary">{formatBangkokDateTime(c.eventAt)} · {group.source==='actions'?'Push':'Recovered'}{group.sequence>connection.reviewedSequence?' · Unread':''}</Typography>
        {(link?.issueId||link?.decisionId)&&<Stack spacing={0.5} sx={{overflowWrap:'anywhere'}}>
          {link.issueId&&<Link href={`/projects/${projectId}/issues`} variant="body2">Issue: {link.issueTitle||'Linked issue'}</Link>}
          {link.decisionId&&<Link href={`/projects/${projectId}/decisions`} variant="body2">Decision: {link.decisionTitle||'Linked decision'}</Link>}
        </Stack>}
        <Accordion disableGutters elevation={0}>
          <AccordionSummary sx={{p:0,minHeight:32}}><Typography variant="caption">Commit details</Typography></AccordionSummary>
          <AccordionDetails sx={{p:0,pb:1}}>
            <Typography variant="body2" sx={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{c.message}</Typography>
            <Typography variant="caption" sx={{overflowWrap:'anywhere'}}>By {c.author} · Received {formatBangkokDateTime(group.receivedAt)}</Typography>
            {!archived&&<Button size="small" onClick={()=>{setSelected(c);setIssue(link?.issueId||'');setDecision(link?.decisionId||'');setSearch('');setDecisionSearch('');setError(null);}}>Link issue / decision</Button>}
          </AccordionDetails>
        </Accordion>
      </Box>;
    })}
    <Stack direction="row" spacing={1}>
      {limit<commits.length&&<Button onClick={()=>setLimit(n=>n+5)}>Show 5 more commits</Button>}
      {limit>5&&<Button onClick={()=>setLimit(5)}>Show latest 5</Button>}
    </Stack>
    <Typography variant="caption" color="text.secondary">Showing {Math.min(limit,commits.length)} of {commits.length} cached commits, newest commit time first. Unread counts update groups, including hidden updates. Opening details never marks updates as reviewed.</Typography>
    <Dialog open={!!selected} onClose={()=>{if(!busy)setSelected(null);}} fullWidth maxWidth="sm">
      <DialogTitle>Link commit {selected?.sha.slice(0,7)}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{mb:2}}>Choose records from this project. This records a connection without completing the issue or changing the decision.</Typography>
        {error&&<Alert severity="error">{error}</Alert>}
        {(issueQuery.isError||decisionQuery.isError)&&<Alert severity="error">Could not load records. Close and reopen to retry.</Alert>}
        <TextField label="Find issue" fullWidth value={search} onChange={e=>setSearch(e.target.value)} sx={{mb:2}} />
        <TextField select label="Linked issue" fullWidth value={issue} onChange={e=>setIssue(e.target.value)} sx={{mb:2}}>
          <MenuItem value="">None</MenuItem>
          {issue&&!issueQuery.data?.items.some(i=>i.id===issue)&&<MenuItem value={issue}>{selectedLink?.issueTitle||'Current linked issue'}</MenuItem>}
          {issueQuery.data?.items.map(i=><MenuItem key={i.id} value={i.id}>{i.title}</MenuItem>)}
        </TextField>
        <TextField label="Find decision" fullWidth value={decisionSearch} onChange={e=>setDecisionSearch(e.target.value)} sx={{mb:2}} />
        <TextField select label="Linked decision" fullWidth value={decision} onChange={e=>setDecision(e.target.value)}>
          <MenuItem value="">None</MenuItem>
          {decision&&!decisionQuery.data?.decisions.some(d=>d.id===decision)&&<MenuItem value={decision}>{selectedLink?.decisionTitle||'Current linked decision'}</MenuItem>}
          {decisionQuery.data?.decisions.map(d=><MenuItem key={d.id} value={d.id}>{d.decision}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={()=>setSelected(null)}>Cancel</Button><Button disabled={busy||archived||issueQuery.isLoading||decisionQuery.isLoading} onClick={()=>void save()}>Save links</Button></DialogActions>
    </Dialog>
  </Stack>;
}
