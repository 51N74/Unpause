import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubContinuity } from '../components/GitHubContinuity';
import { continuityApi, type ContinuityView } from '../api/continuity';

const view: ContinuityView = {
  connection: {id: 'connection-1', repositoryId: 42, fullName: 'solo/demo', branch: 'main', state: 'Awaiting first update', lastDeliveryReceivedAt: null, lastSyncedAt: '2026-01-01T00:00:00Z', lastGitActivityAt: null, incompleteHistory: false, sequence: 3, reviewedSequence: 0},
  returnNote: 'Test expired sessions next', focusIssueId: null, unread: 1,
  activity: [{deliveryId: 'actions:123', sequence: 3, source: 'actions', eventAt: '2026-01-01T00:00:00Z', receivedAt: '2026-01-02T00:00:00Z', commits: [{sha: 'a'.repeat(40), message: '<script>malicious()</script>', author: 'Dev', eventAt: '2026-01-01T00:00:00Z'}]}],
};
let clients: QueryClient[] = [];
afterEach(() => {clients.forEach(c => c.clear()); clients = []; vi.restoreAllMocks(); vi.useRealTimers();});
function mount(archived = false) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}}); clients.push(client);
  return {client, ...render(<QueryClientProvider client={client}><GitHubContinuity projectId="project-1" archived={archived} issues={[]} /></QueryClientProvider>)};
}
describe('GitHub Resume continuity', () => {
  it('keeps unread through refresh and only explicitly acknowledges the displayed sequence', async () => {
    const read = vi.spyOn(continuityApi, 'view').mockResolvedValue(structuredClone(view));
    vi.spyOn(continuityApi, 'sync').mockResolvedValue();
    const review = vi.spyOn(continuityApi, 'review').mockResolvedValue();
    const {client, container} = mount();
    await screen.findByText('1 unread updates');
    expect(review).not.toHaveBeenCalled();
    expect(screen.getByText(/workflow setup required/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByRole('link', {name: 'aaaaaaa'})).toHaveAttribute('href', 'https://github.com/solo/demo/commit/' + 'a'.repeat(40));
    await act(async () => {await client.invalidateQueries({queryKey: ['project', 'project-1', 'github']});});
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Mark all updates as reviewed'}));
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Confirm review all'}));
    await waitFor(() => expect(review).toHaveBeenCalledWith('project-1', 'connection-1', 3));
  });
  it('polls visible activity after 20 seconds and preserves the review marker', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const read = vi.spyOn(continuityApi, 'view').mockResolvedValue(structuredClone(view));
    vi.spyOn(continuityApi, 'sync').mockResolvedValue();
    const review = vi.spyOn(continuityApi, 'review').mockResolvedValue();
    mount();
    await screen.findByText('1 unread updates');
    // Let entry recovery complete before measuring the display poll.
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1));
    vi.useFakeTimers();
    // Recompute the query interval under fake timers through a refresh.
    await act(async () => {await clients[0].invalidateQueries({queryKey: ['project', 'project-1', 'github']});});
    const calls = read.mock.calls.length;
    await act(async () => {await vi.advanceTimersByTimeAsync(20001);});
    expect(read.mock.calls.length).toBeGreaterThan(calls);
    expect(review).not.toHaveBeenCalled();
  });
  it('keeps authored context and cached activity available on sync failure', async () => {
    vi.spyOn(continuityApi, 'view').mockResolvedValue(structuredClone(view));
    vi.spyOn(continuityApi, 'sync').mockRejectedValue(new Error('GitHub unavailable'));
    mount();
    await screen.findByText('GitHub unavailable');
    expect(screen.getByText('Test expired sessions next')).toBeInTheDocument();
    expect(screen.getAllByText(/<script>malicious/).length).toBeGreaterThan(0);
  });
  it('disables all writes and automatic catch-up while archived', async () => {
    vi.spyOn(continuityApi, 'view').mockResolvedValue(structuredClone(view));
    const sync = vi.spyOn(continuityApi, 'sync').mockResolvedValue();
    mount(true);
    await screen.findByText('Continue here');
    expect(sync).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', {name: 'Sync / retry'})).toBeNull();
    expect(screen.queryByRole('button', {name: 'Edit return context'})).toBeNull();
  });
  it('keeps a chosen issue visible when it leaves the top five outstanding issues', async () => {
    vi.spyOn(continuityApi, 'view').mockResolvedValue({...structuredClone(view), focusIssueId: 'older-issue', focusIssue: {id: 'older-issue', title: 'Chosen issue', nextAction: 'Verify the older issue'}});
    vi.spyOn(continuityApi, 'sync').mockResolvedValue();
    mount();
    expect(await screen.findByText('Verify the older issue')).toBeInTheDocument();
  });
  it('saves the return note without changing review state', async () => {
    vi.spyOn(continuityApi, 'view').mockResolvedValue({...structuredClone(view), connection: null});
    const save = vi.spyOn(continuityApi, 'saveContext').mockResolvedValue();
    const review = vi.spyOn(continuityApi, 'review').mockResolvedValue();
    mount();
    fireEvent.click(await screen.findByRole('button', {name: 'Edit return context'}));
    fireEvent.change(screen.getByLabelText('Return note'), {target: {value: 'Next: check expiry'}});
    fireEvent.click(screen.getByRole('button', {name: 'Save return context'}));
    await waitFor(() => expect(save).toHaveBeenCalledWith('project-1', 'Next: check expiry', null));
    expect(review).not.toHaveBeenCalled();
  });
});

describe('Compact commits and pause handoff', () => {
  it('shows five newest commits, expands without reviewing, and collapses again', async () => {
    const v=structuredClone(view);
    v.activity[0].commits=Array.from({length:12},(_,i)=>({sha:i.toString(16).padStart(40,'0'),message:'Change '+i,author:'Dev',eventAt:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
    vi.spyOn(continuityApi,'view').mockResolvedValue(v);vi.spyOn(continuityApi,'sync').mockResolvedValue();
    const review=vi.spyOn(continuityApi,'review').mockResolvedValue();
    mount();await screen.findByText('Latest commits');
    expect(screen.getAllByTestId('commit-row')).toHaveLength(5);
    expect(screen.getAllByTestId('commit-row')[0]).toHaveTextContent('Change 11');
    fireEvent.click(screen.getByRole('button',{name:'Show 5 more commits'}));
    expect(screen.getAllByTestId('commit-row')).toHaveLength(10);
    expect(review).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Show latest 5'}));
    expect(screen.getAllByTestId('commit-row')).toHaveLength(5);
  });
  it('saves a structured pause note, keeps focus and does not acknowledge activity', async () => {
    vi.spyOn(continuityApi,'view').mockResolvedValue({...structuredClone(view),focusIssueId:'focus-1'});
    vi.spyOn(continuityApi,'sync').mockResolvedValue();
    const save=vi.spyOn(continuityApi,'saveContext').mockResolvedValue();const review=vi.spyOn(continuityApi,'review').mockResolvedValue();
    mount();fireEvent.click(await screen.findByRole('button',{name:'Pause work'}));
    expect(screen.getByRole('button',{name:'Save pause note'})).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Where I stopped',{exact:false}),{target:{value:'UI complete'}});
    fireEvent.change(screen.getByLabelText('Next action when I return',{exact:false}),{target:{value:'Check mobile'}});
    fireEvent.click(screen.getByRole('button',{name:'Save pause note'}));
    await waitFor(()=>expect(save).toHaveBeenCalledWith('project-1','Where I stopped: UI complete\nBlockers: None recorded\nNext action: Check mobile','focus-1'));
    expect(review).not.toHaveBeenCalled();await screen.findByText(/Pause note saved/);
  });
  it('keeps the pause draft open on save failure', async () => {
    vi.spyOn(continuityApi,'view').mockResolvedValue(structuredClone(view));vi.spyOn(continuityApi,'sync').mockResolvedValue();
    vi.spyOn(continuityApi,'saveContext').mockRejectedValue(new Error('Save unavailable'));
    mount();fireEvent.click(await screen.findByRole('button',{name:'Pause work'}));
    fireEvent.change(screen.getByLabelText('Where I stopped',{exact:false}),{target:{value:'Draft'}});
    fireEvent.change(screen.getByLabelText('Next action when I return',{exact:false}),{target:{value:'Retry'}});
    fireEvent.click(screen.getByRole('button',{name:'Save pause note'}));
    await screen.findByText('Save unavailable');expect(screen.getByLabelText('Where I stopped',{exact:false})).toHaveValue('Draft');
  });
});

it('review confirmation retains its original snapshot when a new update arrives', async () => {
 const read=vi.spyOn(continuityApi,'view').mockResolvedValue(structuredClone(view));vi.spyOn(continuityApi,'sync').mockResolvedValue();
 const review=vi.spyOn(continuityApi,'review').mockResolvedValue();const {client}=mount();
 fireEvent.click(await screen.findByRole('button',{name:'Mark all updates as reviewed'}));
 const newer=structuredClone(view);newer.connection!.sequence=7;read.mockResolvedValue(newer);
 await act(async()=>{await client.invalidateQueries({queryKey:['project','project-1','github']});});
 fireEvent.click(screen.getByRole('button',{name:'Confirm review all'}));
 await waitFor(()=>expect(review).toHaveBeenCalledWith('project-1','connection-1',3));
});
