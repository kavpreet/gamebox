import { useState } from 'react';
import type { GameOptionDef, GameOptions, GameOptionValue } from '@gamebox/shared-types';
import { describeNonDefaultOptions } from '@gamebox/shared-types';
import { api } from '../api.js';

/**
 * The lobby's alternate-rules card. Entirely driven by the module's declared
 * option defs (see GameModule.options) — this component knows nothing about any
 * specific game. Only the host can change them, and only before the start.
 */
export function HouseRules({
  gameId,
  defs,
  options,
  isHost,
}: {
  gameId: string;
  defs: GameOptionDef[];
  options: GameOptions;
  isHost: boolean;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  if (defs.length === 0) return null;

  const changed = describeNonDefaultOptions(defs, options);

  const patch = async (values: Record<string, GameOptionValue>) => {
    setError('');
    setSaving(true);
    try {
      await api.setOptions(gameId, values);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetAll = () =>
    patch(Object.fromEntries(defs.map((d) => [d.id, d.default])));

  return (
    <div className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>House rules</h3>
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge${changed.length ? ' gold-badge' : ''}`}>
            {changed.length ? `${changed.length} tweaked` : 'standard'}
          </span>
          {isHost && (
            <button className="ghost small" style={{ padding: '0.2em 0.6em' }} onClick={() => setOpen((o) => !o)}>
              {open ? 'Done' : 'Change'}
            </button>
          )}
        </span>
      </div>

      {!open && (
        changed.length > 0 ? (
          <div className="row" style={{ gap: 6 }}>
            {changed.map((c) => (
              <span key={c} className="badge on">{c}</span>
            ))}
          </div>
        ) : (
          <p className="dim small" style={{ margin: 0 }}>
            Playing it by the book.{isHost ? ' Tap Change to bend the rules.' : ''}
          </p>
        )
      )}

      {open && (
        <>
          {defs.map((def) => (
            <OptionRow
              key={def.id}
              def={def}
              value={options[def.id] ?? def.default}
              disabled={saving}
              onChange={(v) => patch({ [def.id]: v })}
            />
          ))}
          {changed.length > 0 && (
            <button className="ghost small" onClick={resetAll} disabled={saving}>
              ↺ Back to standard rules
            </button>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function OptionRow({
  def,
  value,
  disabled,
  onChange,
}: {
  def: GameOptionDef;
  value: GameOptionValue;
  disabled: boolean;
  onChange: (v: GameOptionValue) => void;
}) {
  const isDefault = value === def.default;
  const header = (
    <div className="row between" style={{ gap: 8 }}>
      <span className="grow" style={{ fontWeight: 700 }}>
        {def.label}
        {!isDefault && <span className="badge gold-badge" style={{ marginLeft: 6 }}>house</span>}
      </span>
      {def.kind === 'toggle' && (
        <button
          className={value ? '' : 'secondary'}
          disabled={disabled}
          style={{ minWidth: 74, padding: '0.35em 0.9em' }}
          onClick={() => onChange(!value)}
        >
          {value ? 'On' : 'Off'}
        </button>
      )}
      {def.kind === 'number' && (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button
            className="secondary"
            disabled={disabled || (value as number) <= def.min}
            style={{ padding: '0.3em 0.7em' }}
            onClick={() => onChange((value as number) - (def.step ?? 1))}
          >
            −
          </button>
          <strong style={{ minWidth: 62, textAlign: 'center' }}>
            {def.prefix ?? ''}{value}
          </strong>
          <button
            className="secondary"
            disabled={disabled || (value as number) >= def.max}
            style={{ padding: '0.3em 0.7em' }}
            onClick={() => onChange((value as number) + (def.step ?? 1))}
          >
            +
          </button>
        </span>
      )}
    </div>
  );

  const choiceHint =
    def.kind === 'choice' ? def.choices.find((c) => c.value === value)?.description : undefined;

  return (
    <div style={{ borderTop: '1px solid var(--line)', paddingTop: '0.7rem' }}>
      {header}
      {def.kind === 'choice' && (
        <div className="row" style={{ gap: 6, marginTop: 6 }}>
          {def.choices.map((c) => (
            <button
              key={c.value}
              className={c.value === value ? '' : 'secondary'}
              disabled={disabled}
              style={{ padding: '0.35em 0.9em', fontSize: '0.9rem' }}
              onClick={() => onChange(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      {(choiceHint ?? def.description) && (
        <p className="dim small" style={{ margin: '6px 0 0' }}>{choiceHint ?? def.description}</p>
      )}
    </div>
  );
}
