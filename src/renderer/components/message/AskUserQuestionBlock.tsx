// AskUserQuestion tool block — interactive when pending, read-only otherwise
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCircle2, HelpCircle } from 'lucide-react';
import { useIPC } from '../../hooks/useIPC';
import { useAppStore } from '../../store';
import type { ToolUseContent, QuestionItem } from '../../types';

interface AskUserQuestionBlockProps {
  block: ToolUseContent;
}

function isAskUserQuestionToolName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/_/g, '');
  return normalized === 'askuserquestion';
}

export function AskUserQuestionBlock({ block }: AskUserQuestionBlockProps) {
  const { t } = useTranslation();
  const { respondToQuestion } = useIPC();
  const pendingQuestion = useAppStore((s) => s.pendingQuestion);
  const [selections, setSelections] = useState<Record<number, string[]>>({});
  const [submitted, setSubmitted] = useState(false);

  const questions: QuestionItem[] =
    ((block.input as Record<string, unknown>)?.questions as QuestionItem[]) || [];

  const isPending =
    !submitted && pendingQuestion?.toolUseId === block.id && isAskUserQuestionToolName(block.name);
  const isAnswered = submitted;
  const isReadOnly = !isPending;

  const handleOptionToggle = (questionIdx: number, label: string, multiSelect: boolean) => {
    if (isReadOnly) {
      return;
    }

    setSelections((prev) => {
      const current = prev[questionIdx] || [];
      if (multiSelect) {
        if (current.includes(label)) {
          return { ...prev, [questionIdx]: current.filter((entry) => entry !== label) };
        }
        return { ...prev, [questionIdx]: [...current, label] };
      }
      return { ...prev, [questionIdx]: [label] };
    });
  };

  const handleSubmit = () => {
    if (!pendingQuestion || submitted) {
      return;
    }

    respondToQuestion(pendingQuestion.questionId, JSON.stringify(selections));
    setSubmitted(true);
  };

  const canSubmit =
    isPending &&
    !submitted &&
    questions.every((question, index) => {
      if (question.options && question.options.length > 0) {
        return (selections[index] || []).length > 0;
      }
      return true;
    });

  const getOptionLetter = (index: number) => String.fromCharCode(65 + index);

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4">
        <span className="text-text-muted">{t('messageCard.noQuestions')}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-accent/30 bg-gradient-to-br from-accent/5 to-transparent overflow-hidden">
      <div className="px-4 py-3 bg-accent/10 border-b border-accent/20 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
          <HelpCircle className="w-4 h-4 text-accent" />
        </div>
        <div>
          <span className="font-medium text-sm text-text-primary">
            {isAnswered
              ? t('messageCard.questionsAnswered')
              : isPending
                ? t('messageCard.pleaseAnswerToContinue')
                : t('messageCard.questionClosed')}
          </span>
        </div>
        {isAnswered && <CheckCircle2 className="w-5 h-5 text-success ml-auto" />}
      </div>

      <div className="p-4 space-y-5">
        {questions.map((question, questionIndex) => (
          <div key={questionIndex} className="space-y-2">
            {question.header && (
              <span className="inline-block px-2 py-0.5 bg-accent/10 text-accent text-xs font-semibold rounded uppercase tracking-wide">
                {question.header}
              </span>
            )}
            <p className="text-text-primary font-medium text-sm">{question.question}</p>
            {question.options && question.options.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {question.options.map((option, optionIndex) => {
                  const isSelected = (selections[questionIndex] || []).includes(option.label);
                  const letter = getOptionLetter(optionIndex);

                  return (
                    <button
                      key={optionIndex}
                      type="button"
                      onClick={() =>
                        handleOptionToggle(
                          questionIndex,
                          option.label,
                          question.multiSelect || false
                        )
                      }
                      disabled={isReadOnly}
                      className={`w-full p-3 rounded-lg border text-left transition-all ${
                        isReadOnly
                          ? isSelected
                            ? 'border-accent/50 bg-accent/10 cursor-default'
                            : 'border-border-subtle bg-surface-muted cursor-default opacity-60'
                          : isSelected
                            ? 'border-accent bg-accent/10 hover:bg-accent/15'
                            : 'border-border-subtle bg-surface hover:border-border-default hover:bg-surface-muted'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 text-xs font-semibold ${
                            isSelected
                              ? 'bg-accent text-white'
                              : 'bg-border-subtle text-text-secondary'
                          }`}
                        >
                          {isSelected ? <Check className="w-3.5 h-3.5" /> : letter}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span
                            className={`text-sm ${isSelected ? 'text-accent font-medium' : 'text-text-primary'}`}
                          >
                            {option.label}
                          </span>
                          {option.description && (
                            <p className="text-xs text-text-muted mt-0.5">{option.description}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {isPending && !submitted && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="w-full py-2.5 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('messageCard.submitAnswers')}
          </button>
        </div>
      )}
    </div>
  );
}
