// Owner: WP-COL (see PLAN.md §4). The Next fixture block (A§5, DEC D10, DEC D17).
import React from 'react';
import { routeWorthSaying } from '../../viewModels/format.js';

/** Odds row (A§5): "SRB 37%" · bar filled to the attacker's % · "63% ITA". The bar carries the full-name label; `title` the strengths behind it. */
export function OddsRow({ odds, title }) {
  if (!odds) return null;
  const fill = Math.max(0, Math.min(100, Number(odds.fill) || 0));
  return (
    <div className="odds" title={title || undefined}>
      <span className="odds__label odds__label--a" aria-hidden="true">{odds.aLabel}</span>
      <span className="odds__bar" role="img" aria-label={odds.aria}>
        <span className="odds__fill" style={{ width: `${fill}%` }} />
      </span>
      <span className="odds__label odds__label--b" aria-hidden="true">{odds.bLabel}</span>
    </div>
  );
}

/**
 * Every DEC D10 state from one FixtureModel (src/viewModels/campaign.js buildFixture):
 * - idle: placeholder title ("Next draw" / "Italy to attack") + route line, no odds;
 * - drawing (compass still spinning): "<A> to attack" + "The compass is choosing the target", no odds yet;
 * - locked: "<A> v <B>" + a route that is not the ordinary land border + odds (the strengths on their title);
 * - tactical: the same + the approach Continue kicks off with, in the kicker, "Match preview" (onPreview) and "Simulate"
 *   (onSimulate);
 * - live / done: the compact MatchCard slot (score, minute, result), then what comes next.
 * The `matchCard` slot is rendered whenever App passes it (i.e. whenever `st.match` exists).
 * Headings: the section name ("Next fixture") is the h2, the matchup an h3 under it.
 */
export default function NextFixture({ fixture = null, idleText = null, matchCard = null, onPreview, onSimulate, onSkip, onStopSkip }) {
  const model = fixture || {};
  const state = model.state || 'idle';
  const kicker = model.kicker || 'Next fixture';
  const headline = model.headline || null;
  const idleTitle = model.idleTitle || null;
  const route = routeWorthSaying(model.route) || (fixture ? null : idleText);
  const actions = model.actions || {};
  const preview = !!actions.preview && typeof onPreview === 'function';
  const simulate = !!actions.simulate && typeof onSimulate === 'function';
  const next = model.next || null;
  // "Skip to my next match" (fixture.skip, campaign.js skipAheadModel): offered between your decisions, Stop while it runs.
  const skip = model.skip || null;
  const skipping = !!skip?.active;
  const skipOffered = !!skip && !skipping && typeof onSkip === 'function';
  return (
    <section className={`fixture fixture--${state}`} aria-labelledby="fixture-kicker">
      <div className="kicker">
        <h2 className="kicker__title v4-column__heading" id="fixture-kicker">{kicker}</h2>
        {model.approach ? <span className="kicker__aside fixture__approach" title={`Continue kicks off with ${model.approach}, the recommended approach.`}>{model.approach}</span> : null}
      </div>
      {matchCard ? <div className="fixture__card">{matchCard}</div> : <>
        {headline
          ? <h3 className="fixture__title">{headline.a} <span className="fixture__v">v</span> {headline.b}</h3>
          : idleTitle ? <h3 className="fixture__title fixture__title--idle">{idleTitle}</h3> : null}
        {route ? <p className="fixture__route">{route}</p> : null}
        <OddsRow odds={model.odds} title={model.meta} />
      </>}
      {(preview || simulate) && <div className="fixture__actions">
        {preview && <button type="button" className="btn-secondary fixture__preview" onClick={() => onPreview()}>Match preview</button>}
        {simulate && <button type="button" className="btn-link fixture__simulate" onClick={() => onSimulate()}>Simulate</button>}
      </div>}
      {next && next.title ? <p className="fixture__next">
        <span className="fixture__next-title">{next.title}</span>{next.route ? ` · ${next.route}` : null}
      </p> : null}
      {skipOffered && <button type="button" className="btn-secondary fixture__skip" onClick={() => onSkip()}>Skip to your next match</button>}
      {skipping && <p className="fixture__skipping" role="status">
        <span>{`Skipping · ${skip.played} ${skip.played === 1 ? 'match' : 'matches'} played`}</span>
        {typeof onStopSkip === 'function' && <button type="button" className="btn-link fixture__skip-stop" onClick={() => onStopSkip()}>Stop</button>}
      </p>}
    </section>
  );
}
