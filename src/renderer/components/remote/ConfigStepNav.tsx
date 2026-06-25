/**
 * ConfigStepNav — tab navigation for Slack remote configuration steps
 */

import { useTranslation } from 'react-i18next';
import { MessageSquare, Settings2, CheckCircle2 } from 'lucide-react';
import type { ConfigStep } from './types';

interface Props {
  activeStep: ConfigStep;
  isSlackConfigured: boolean;
  onStepChange: (step: ConfigStep) => void;
}

export function ConfigStepNav({ activeStep, isSlackConfigured, onStepChange }: Props) {
  const { t } = useTranslation();

  const steps: { id: ConfigStep; labelKey: string; icon: React.ElementType; done: boolean }[] = [
    {
      id: 'slack',
      labelKey: 'remote.stepSlack',
      icon: MessageSquare,
      done: isSlackConfigured,
    },
    {
      id: 'advanced',
      labelKey: 'remote.stepAdvanced',
      icon: Settings2,
      done: true,
    },
  ];

  return (
    <div className="flex items-center gap-2 p-1 bg-surface rounded-xl">
      {steps.map((step) => (
        <button
          key={step.id}
          onClick={() => onStepChange(step.id)}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg transition-all ${
            activeStep === step.id
              ? 'bg-accent text-white'
              : 'hover:bg-surface-hover text-text-secondary'
          }`}
        >
          {step.done && activeStep !== step.id ? (
            <CheckCircle2 className="w-4 h-4 text-success" />
          ) : (
            <step.icon className="w-4 h-4" />
          )}
          <span className="text-sm font-medium">{t(step.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
