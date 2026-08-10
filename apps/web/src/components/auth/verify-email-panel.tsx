'use client';

import { Alert, Button, Card, CardContent, CardHeader, CardTitle, FormField, Input } from '@reality/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

type State =
  | { kind: 'awaiting' }
  | { kind: 'verifying' }
  | { kind: 'verified' }
  | { kind: 'failed'; message: string };

export function VerifyEmailPanel() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const token = searchParams.get('token');
  const [state, setState] = useState<State>(token ? { kind: 'verifying' } : { kind: 'awaiting' });
  const [resendEmail, setResendEmail] = useState('');
  const [resent, setResent] = useState(false);
  // React 18/19 mounts effects twice in development; the ref keeps a one-shot
  // token from being spent twice and reported as already used.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    api
      .post('/auth/verify-email', { token })
      .then(async () => {
        setState({ kind: 'verified' });
        await queryClient.invalidateQueries({ queryKey: queryKeys.auth.me });
      })
      .catch((error: unknown) => {
        setState({
          kind: 'failed',
          message:
            error instanceof ApiError
              ? error.message
              : 'We could not confirm this link. Request a new one.',
        });
      });
  }, [token, queryClient]);

  async function resend() {
    const email = resendEmail || user?.email;
    if (!email) return;
    await api.post('/auth/resend-verification', { email }).catch(() => undefined);
    setResent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">
          {state.kind === 'verified' ? 'Email confirmed' : 'Confirm your email'}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        {state.kind === 'verifying' && (
          <Alert tone="info" title="Checking your link…">
            This only takes a moment.
          </Alert>
        )}

        {state.kind === 'verified' && (
          <>
            <Alert tone="success" title="You are all set.">
              Your account is active and you can take part in polls, predictions and challenges.
            </Alert>
            <Button asChild fullWidth>
              <Link href="/dashboard">Go to the dashboard</Link>
            </Button>
          </>
        )}

        {state.kind === 'failed' && (
          <Alert tone="danger" title="That link did not work">
            {state.message}
          </Alert>
        )}

        {(state.kind === 'awaiting' || state.kind === 'failed') && (
          <>
            <p className="text-sm text-muted">
              We sent a confirmation link to{' '}
              {user?.email ? (
                <span className="text-foreground">{user.email}</span>
              ) : (
                'your email address'
              )}
              . You need to confirm it before you can vote, predict or submit a challenge — this is
              one of the ways we keep the game to one account per person.
            </p>

            {resent ? (
              <Alert tone="success">
                If that address still needs confirming, a new link is on its way.
              </Alert>
            ) : (
              <div className="space-y-3">
                {!user && (
                  <FormField label="Email" htmlFor="resend-email">
                    <Input
                      id="resend-email"
                      type="email"
                      placeholder="you@example.com"
                      value={resendEmail}
                      onChange={(event) => setResendEmail(event.target.value)}
                    />
                  </FormField>
                )}
                <Button variant="secondary" fullWidth onClick={resend}>
                  Send a new link
                </Button>
              </div>
            )}

            <p className="text-xs text-muted">
              In development the email is printed to the API console instead of being delivered.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
