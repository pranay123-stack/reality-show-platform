'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  CHALLENGE_CATEGORIES,
  TEXT_LIMITS,
  createChallengeSchema,
  type CreateChallengeInput,
} from '@reality/shared';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Textarea,
} from '@reality/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { useContestants } from '@/hooks/use-contestants';
import { ApiError, api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

export function CreateChallengeForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: contestants } = useContestants('name');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateChallengeInput>({
    resolver: zodResolver(createChallengeSchema),
    defaultValues: {
      title: '',
      description: '',
      category: 'CREATIVE',
      targetType: 'HOUSE',
      targetContestantId: null,
      submit: true,
    },
  });

  const targetType = watch('targetType');
  const description = watch('description') ?? '';

  async function onSubmit(values: CreateChallengeInput) {
    setFormError(null);
    try {
      const created = await api.post<{ id: string }>('/challenges', values);
      await queryClient.invalidateQueries({ queryKey: queryKeys.challenges.all });
      toast.success('Sent to moderation. You will see it in "Mine" while it is reviewed.');
      router.push(`/challenges/${created.id}`);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      );
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/challenges"
        className="inline-flex min-h-6 items-center gap-1.5 text-sm text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        All challenges
      </Link>

      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">Write a challenge</CardTitle>
          <CardDescription>
            Every challenge is read by a moderator before the community sees it. Keep it safe,
            achievable and about the show.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {formError && <Alert tone="danger">{formError}</Alert>}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              label="Title"
              htmlFor="title"
              error={errors.title?.message}
              hint="Short and specific — this is what people vote on."
              required
            >
              <Input
                id="title"
                maxLength={TEXT_LIMITS.CHALLENGE_TITLE_MAX}
                placeholder="Silent breakfast"
                aria-invalid={Boolean(errors.title)}
                {...register('title')}
              />
            </FormField>

            <FormField
              label="What should happen?"
              htmlFor="description"
              error={errors.description?.message}
              hint={`${description.length}/${TEXT_LIMITS.CHALLENGE_DESCRIPTION_MAX} characters`}
              required
            >
              <Textarea
                id="description"
                rows={6}
                maxLength={TEXT_LIMITS.CHALLENGE_DESCRIPTION_MAX}
                placeholder="Describe the task clearly enough that the house could actually attempt it."
                aria-invalid={Boolean(errors.description)}
                {...register('description')}
              />
            </FormField>

            <FormField label="Category" htmlFor="category" error={errors.category?.message} required>
              <select
                id="category"
                className="h-11 w-full rounded-md border border-border bg-input px-3.5 text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                {...register('category')}
              >
                {CHALLENGE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category.charAt(0) + category.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </FormField>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who is it for?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {(['HOUSE', 'CONTESTANT'] as const).map((option) => (
                  <label
                    key={option}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-md border p-3 text-sm transition-colors ${
                      targetType === option
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-border-strong'
                    }`}
                  >
                    <input
                      type="radio"
                      value={option}
                      className="accent-[hsl(var(--primary))]"
                      {...register('targetType')}
                      onChange={(event) => {
                        setValue('targetType', event.target.value as 'HOUSE' | 'CONTESTANT');
                        if (event.target.value === 'HOUSE') setValue('targetContestantId', null);
                      }}
                    />
                    {option === 'HOUSE' ? 'The whole house' : 'One contestant'}
                  </label>
                ))}
              </div>
            </fieldset>

            {targetType === 'CONTESTANT' && (
              <FormField
                label="Contestant"
                htmlFor="targetContestantId"
                error={errors.targetContestantId?.message}
                required
              >
                <select
                  id="targetContestantId"
                  className="h-11 w-full rounded-md border border-border bg-input px-3.5 text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  {...register('targetContestantId')}
                >
                  <option value="">Choose a contestant…</option>
                  {contestants?.map((contestant) => (
                    <option key={contestant.id} value={contestant.id}>
                      {contestant.displayName}
                    </option>
                  ))}
                </select>
              </FormField>
            )}

            <Alert tone="info">
              Challenges that involve harm, deprivation or abuse are rejected automatically.
              Everything else goes to a human moderator.
            </Alert>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" loading={isSubmitting} fullWidth>
                Send to moderation
              </Button>
              <Button
                type="button"
                variant="secondary"
                fullWidth
                onClick={handleSubmit((values) => onSubmit({ ...values, submit: false }))}
              >
                Save as draft
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
