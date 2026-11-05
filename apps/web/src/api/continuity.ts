import { apiClient } from './client';
export interface GitCommit { sha: string; message: string; author: string; eventAt: string }
export interface GitConnection {
  id: string; repositoryId: number; fullName: string; branch: string; state: string;
  lastDeliveryReceivedAt: string | null; lastSyncedAt: string | null;
  lastGitActivityAt: string | null; incompleteHistory: boolean;
  sequence: number; reviewedSequence: number;
}
export interface ContinuityView {
  focusIssue?: {id: string; title: string; nextAction: string} | null;
  connection: GitConnection | null; returnNote: string; focusIssueId: string | null; unread: number;
  activity: { deliveryId: string; sequence: number; source: string; eventAt: string; receivedAt: string; commits: GitCommit[] }[];
}
const path = (id: string) => `/projects/${id}/github`;
export const continuityApi = {
  view: async (id: string) => (await apiClient.get<ContinuityView>(path(id))).data,
  connect: async (id: string, url: string) => (await apiClient.post<{connection: GitConnection; secret: string}>(path(id), {url})).data,
  rotate: async (id: string) => (await apiClient.post<{secret: string}>(`${path(id)}/rotate`)).data,
  unlink: async (id: string) => { await apiClient.delete(path(id)); },
  sync: async (id: string, force: boolean) => { await apiClient.post(`${path(id)}/sync`, {force}, {timeout: 30000}); },
  review: async (id: string, connectionId: string, sequence: number) => { await apiClient.post(`${path(id)}/review`, {connectionId, sequence}); },
  saveContext: async (id: string, returnNote: string, focusIssueId: string | null) => { await apiClient.put(`/projects/${id}/return-context`, {returnNote, focusIssueId}); },
};
