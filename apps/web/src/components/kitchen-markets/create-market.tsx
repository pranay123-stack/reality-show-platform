'use client';

import type { CreateKitchenMarketInput, KitchenMarketCategory, KitchenMarketSlot } from '@reality/shared';
import {
  KITCHEN_CATEGORY_LABELS,
  KITCHEN_MARKET_CATEGORIES,
  KITCHEN_MARKET_SLOTS,
  KITCHEN_SLOT_LABELS,
  createKitchenMarketSchema,
} from '@reality/shared';
import {
  Button,
  FormField,
  Input,
  Modal,
  ModalContent,
  cn,
} from '@reality/ui';
import { ChefHat, Flame, Plus, Sunrise, Swords, Trash2, Utensils, Vote } from 'lucide-react';
import { useState } from 'react';

import { landingContestants } from '@/lib/mock-landing';

/**
 * The five-step market composer.
 *
 * Each step asks one thing, and the step cannot be left until that thing is
 * answered — which is what keeps the summary at the end honest. Validation is
 * `createKitchenMarketSchema`, the same schema the future endpoint will parse,
 * so a market that passes here is a market the server will accept.
 */

const CATEGORY_ICON: Record<KitchenMarketCategory, typeof ChefHat> = {
  COOKING: ChefHat,
  CONTESTANT_BATTLE: Swords,
  FOOD_CHOICE: Utensils,
  HOUSE_DECISION: Vote,
  DRAMA: Flame,
};

/** A starting point per category, so nobody faces an empty form. */
const TEMPLATE: Record<KitchenMarketCategory, { question: string; options: string[] }> = {
  COOKING: {
    question: 'Who will cook pasta tonight?',
    options: ['Mira Sol', 'Aria Vale', 'Dev Rahman', 'Lena Frost'],
  },
  CONTESTANT_BATTLE: {
    question: 'Who will win the cooking battle?',
    options: ['Mira wins', 'Aria wins'],
  },
  FOOD_CHOICE: {
    question: 'What will the house eat tomorrow morning?',
    options: ['Pancakes', 'Eggs', 'Rice', 'Fruits'],
  },
  HOUSE_DECISION: {
    question: 'Who will prepare dinner?',
    options: ['Mira Sol', 'Aria Vale', 'Dev Rahman', 'Lena Frost'],
  },
  DRAMA: {
    question: 'Will the kitchen argument happen tonight?',
    options: ['Yes', 'No'],
  },
};

const SLOT_ICON: Record<KitchenMarketSlot, typeof Sunrise> = {
  MORNING: Sunrise,
  AFTERNOON: Utensils,
  EVENING: ChefHat,
  NIGHT: Flame,
};

const STEPS = ['Category', 'Question', 'Options', 'When', 'Publish'] as const;

export function CreateMarketDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (input: CreateKitchenMarketInput) => void;
}) {
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState<KitchenMarketCategory | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [slot, setSlot] = useState<KitchenMarketSlot | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep(0);
    setCategory(null);
    setQuestion('');
    setOptions([]);
    setSlot(null);
    setError(null);
  }

  function chooseCategory(next: KitchenMarketCategory) {
    setCategory(next);
    // Prefill from the template, but only while the composer is untouched —
    // going back to change category should not silently discard typed work.
    if (!question) setQuestion(TEMPLATE[next].question);
    if (options.length === 0) setOptions([...TEMPLATE[next].options]);
    setStep(1);
  }

  function publish() {
    const parsed = createKitchenMarketSchema.safeParse({
      category,
      question,
      slot,
      options: options
        .map((label) => label.trim())
        .filter(Boolean)
        .map((label) => ({
          label,
          // A label that matches a contestant carries their id, so the market
          // can show a face rather than a name.
          contestantId: landingContestants.find((c) => label.startsWith(c.name))?.id ?? null,
        })),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'That market is not quite ready');
      return;
    }

    onCreate(parsed.data);
    reset();
    onClose();
  }

  const canAdvance =
    (step === 0 && category) ||
    (step === 1 && question.trim().length >= 10) ||
    (step === 2 && options.filter((o) => o.trim()).length >= 2) ||
    (step === 3 && slot) ||
    step === 4;

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          reset();
          onClose();
        }
      }}
    >
      <ModalContent
        title="Create a kitchen market"
        description="Five steps. The house does the rest."
        className="max-w-xl"
        footer={
          <>
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
                Continue
              </Button>
            ) : (
              <Button onClick={publish}>Publish market</Button>
            )}
          </>
        }
      >
        <div className="space-y-5">
          <StepRail step={step} />

          {step === 0 && (
            <fieldset className="space-y-3">
              <legend className="sr-only">Choose a category</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {KITCHEN_MARKET_CATEGORIES.map((value) => {
                  const Icon = CATEGORY_ICON[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseCategory(value)}
                      aria-pressed={category === value}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
                        category === value
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border text-muted hover:border-border-strong hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {KITCHEN_CATEGORY_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {step === 1 && (
            <FormField
              label="What are people predicting?"
              htmlFor="market-question"
              hint="Ten characters or more. A question with one clear answer settles cleanly."
              required
            >
              <Input
                id="market-question"
                value={question}
                maxLength={140}
                placeholder="Who will cook dinner tonight?"
                onChange={(event) => setQuestion(event.target.value)}
              />
            </FormField>
          )}

          {step === 2 && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                The options
                <span className="ml-2 text-xs font-normal text-muted">
                  Two to six. One of them has to end up true.
                </span>
              </legend>

              <ul className="space-y-2">
                {options.map((option, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Input
                      aria-label={`Option ${index + 1}`}
                      value={option}
                      maxLength={60}
                      onChange={(event) =>
                        setOptions((previous) =>
                          previous.map((entry, position) =>
                            position === index ? event.target.value : entry,
                          ),
                        )
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove option ${index + 1}`}
                      disabled={options.length <= 2}
                      onClick={() =>
                        setOptions((previous) => previous.filter((_, position) => position !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>

              {options.length < 6 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setOptions((previous) => [...previous, ''])}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add an option
                </Button>
              )}
            </fieldset>
          )}

          {step === 3 && (
            <fieldset className="space-y-3">
              <legend className="sr-only">Choose when it runs</legend>
              <div className="grid grid-cols-2 gap-2">
                {KITCHEN_MARKET_SLOTS.map((value) => {
                  const Icon = SLOT_ICON[value];
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSlot(value)}
                      aria-pressed={slot === value}
                      className={cn(
                        'flex min-h-11 items-center gap-3 rounded-lg border p-3 text-left text-sm transition-colors',
                        slot === value
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border text-muted hover:border-border-strong hover:text-foreground',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden />
                      {KITCHEN_SLOT_LABELS[value]}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <dl className="space-y-2 rounded-lg border border-border bg-white/[0.03] p-4 text-sm">
                <Summary term="Category" value={category ? KITCHEN_CATEGORY_LABELS[category] : '—'} />
                <Summary term="Question" value={question} />
                <Summary
                  term="Options"
                  value={options.filter((o) => o.trim()).join(' · ')}
                />
                <Summary term="Runs" value={slot ? KITCHEN_SLOT_LABELS[slot] : '—'} />
              </dl>

              {error && (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}

              <p className="text-xs text-muted">
                Publishing earns 20 market points, and 25 more if it draws a crowd.
              </p>
            </div>
          )}
        </div>
      </ModalContent>
    </Modal>
  );
}

function Summary({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-muted">{term}</dt>
      <dd className="min-w-0 flex-1 break-words">{value || '—'}</dd>
    </div>
  );
}

/** Which step you are on, and how many are left. */
function StepRail({ step }: { step: number }) {
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
      {STEPS.map((label, index) => (
        <li key={label} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            aria-hidden
            className={cn(
              'h-1 rounded-full transition-colors',
              index <= step ? 'bg-primary' : 'bg-white/10',
            )}
          />
          <span
            className={cn(
              'truncate text-[10px] uppercase tracking-[0.12em]',
              index === step ? 'text-foreground' : 'text-muted',
            )}
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The button that opens the composer. */
export function CreateMarketButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick}>
      <Plus className="h-4 w-4" aria-hidden />
      Create market
    </Button>
  );
}

