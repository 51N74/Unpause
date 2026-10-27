import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import StarOutlineIcon from '@mui/icons-material/StarOutline';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { useQuery } from '@tanstack/react-query';
import { githubApi } from '../api/endpoints';
import { ErrorState } from '../components/ErrorState';
import { formatBangkokDate } from '../utils/date';

const POPULAR_LANGUAGES = [
  '',
  'TypeScript',
  'JavaScript',
  'Python',
  'Go',
  'Rust',
  'Java',
  'C#',
  'Ruby',
];

export const GitHubExplorerPage: React.FC = () => {
  const [searchInput, setSearchInput] = useState('react');
  const [debouncedQuery, setDebouncedQuery] = useState('react');
  const [language, setLanguage] = useState('');
  const [minStarsInput, setMinStarsInput] = useState('100');
  const [debouncedMinStars, setDebouncedMinStars] = useState<number | undefined>(
    100
  );
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchInput.trim());
      const parsedStars =
        minStarsInput.trim() === '' ? undefined : Number(minStarsInput);
      setDebouncedMinStars(
        parsedStars !== undefined && !Number.isNaN(parsedStars) && parsedStars >= 0
          ? Math.floor(parsedStars)
          : undefined
      );
      setPage(1);
    }, 350);

    return () => clearTimeout(timer);
  }, [searchInput, minStarsInput]);

  const githubQuery = useQuery({
    queryKey: [
      'github',
      'repositories',
      {
        q: debouncedQuery,
        language: language || undefined,
        minStars: debouncedMinStars,
        page,
      },
    ],
    queryFn: () =>
      githubApi.searchRepositories({
        q: debouncedQuery,
        language: language || undefined,
        minStars: debouncedMinStars,
        page,
        perPage: 10,
      }),
    enabled: debouncedQuery.length > 0,
    retry: false,
  });

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 800 }}>
          GitHub Repository Explorer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Search public GitHub repositories via the backend API with language
          and minimum-star filters.
        </Typography>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
        }}
      >
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={6}>
            <TextField
              size="small"
              label="Search GitHub repositories *"
              placeholder="e.g., state machine,zod, prisma..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              fullWidth
            />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel id="github-language-label">Language</InputLabel>
              <Select
                labelId="github-language-label"
                label="Language"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  setPage(1);
                }}
              >
                {POPULAR_LANGUAGES.map((lang) => (
                  <MenuItem key={lang || 'all'} value={lang}>
                    {lang || 'Any Language'}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              size="small"
              label="Minimum Stars"
              type="number"
              inputProps={{ min: 0 }}
              value={minStarsInput}
              onChange={(e) => setMinStarsInput(e.target.value)}
              fullWidth
            />
          </Grid>
        </Grid>
      </Paper>

      {debouncedQuery.length === 0 && (
        <Paper
          elevation={0}
          sx={{
            p: 5,
            textAlign: 'center',
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Enter a search query above to explore public GitHub repositories.
          </Typography>
        </Paper>
      )}

      {debouncedQuery.length > 0 && githubQuery.isFetching && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {debouncedQuery.length > 0 &&
        !githubQuery.isFetching &&
        githubQuery.isError && (
          <ErrorState
            title="GitHub API Request Failed"
            error={githubQuery.error}
            onRetry={() => void githubQuery.refetch()}
          />
        )}

      {debouncedQuery.length > 0 &&
        !githubQuery.isFetching &&
        !githubQuery.isError &&
        githubQuery.data && (
          <>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mb: 2 }}
            >
              <Typography variant="body2" color="text.secondary">
                Found{' '}
                <strong>{githubQuery.data.totalCount.toLocaleString()}</strong>{' '}
                matching repositories (Page {githubQuery.data.page})
              </Typography>
            </Stack>

            {githubQuery.data.items.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  p: 5,
                  textAlign: 'center',
                  border: '1px dashed',
                  borderColor: 'divider',
                  borderRadius: 2,
                }}
              >
                <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
                  No repositories matched your search
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Try broadening your keyword query, lowering minimum stars, or
                  selecting Any Language.
                </Typography>
              </Paper>
            ) : (
              <>
                <Grid container spacing={2.5}>
                  {githubQuery.data.items.map((repo) => (
                    <Grid item xs={12} md={6} key={repo.id}>
                      <Card
                        elevation={0}
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                        }}
                      >
                        <CardContent sx={{ flexGrow: 1 }}>
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="flex-start"
                            spacing={1}
                            sx={{ mb: 1 }}
                          >
                            <Typography
                              variant="subtitle1"
                              sx={{ fontWeight: 700, wordBreak: 'break-word' }}
                            >
                              {repo.fullName}
                            </Typography>
                            {repo.language && (
                              <Chip
                                size="small"
                                label={repo.language}
                                color="primary"
                                variant="outlined"
                              />
                            )}
                          </Stack>

                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ mb: 2, minHeight: 40 }}
                          >
                            {repo.description || 'No description provided.'}
                          </Typography>

                          <Stack
                            direction="row"
                            spacing={2}
                            alignItems="center"
                            flexWrap="wrap"
                          >
                            <Stack
                              direction="row"
                              spacing={0.5}
                              alignItems="center"
                            >
                              <StarOutlineIcon
                                fontSize="small"
                                color="warning"
                              />
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {repo.stargazersCount.toLocaleString()}
                              </Typography>
                            </Stack>

                            <Stack
                              direction="row"
                              spacing={0.5}
                              alignItems="center"
                            >
                              <CallSplitIcon fontSize="small" color="action" />
                              <Typography variant="body2">
                                {repo.forksCount.toLocaleString()}
                              </Typography>
                            </Stack>

                            <Typography variant="caption" color="text.secondary">
                              Updated: {formatBangkokDate(repo.updatedAt)}
                            </Typography>
                          </Stack>
                        </CardContent>
                        <Divider />
                        <CardActions sx={{ px: 2, py: 1 }}>
                          <Button
                            size="small"
                            component="a"
                            href={repo.htmlUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            endIcon={<OpenInNewIcon fontSize="small" />}
                          >
                            Open on GitHub
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>

                <Stack
                  direction="row"
                  justifyContent="center"
                  alignItems="center"
                  spacing={2}
                  sx={{ mt: 4 }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<NavigateBeforeIcon />}
                    disabled={!githubQuery.data.hasPreviousPage}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Page {githubQuery.data.page}
                  </Typography>
                  <Button
                    variant="outlined"
                    endIcon={<NavigateNextIcon />}
                    disabled={!githubQuery.data.hasNextPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </Stack>
              </>
            )}
          </>
        )}
    </Box>
  );
};
