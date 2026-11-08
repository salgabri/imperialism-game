// Owner: WP-SQUAD (see PLAN.md §4). The Squad view (boards C1/C2, A-4 breakpoints, C§12 tab proposals).
// Presentational: the model comes from buildSquad(st, ctx, teamId) (src/viewModels/squad.js); the only local
// state is the List / Pitch / Acquisitions tab (UI-only, never saved).
// Compact pass (docs/design/compact-pass.md): one view of the lineup at a time, the list or the pitch, with the strength
// profile and the bench beside it. Every list pages to what fits; a phone's bench is a tab of its own.
import React, { useMemo, useState } from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import Icon from '../../components/Icon.jsx';
import SquadRow, { SquadTableHead } from './SquadRow.jsx';
import SquadPhoneRow from './SquadPhoneRow.jsx';
import SquadPitch from './SquadPitch.jsx';
import StrengthProfile from './StrengthProfile.jsx';
import SquadAcquisitions from './SquadAcquisitions.jsx';
import Pager from '../../components/Pager.jsx';
import { usePagedList } from '../../hooks/useFit.js';
import './squad.css';

/**
 * Back / Your squad / Follow (not drawn on the boards). They live inside the headers so C1/C2 keep their height:
 * desktop top-right on the kicker line, tablet at the end of the tabs row, phone at the end of the meta line
 * (`compact`: an icon-only Back and a short Follow label, full names kept as accessible names).
 */
function Tools({ back, home, canFollow, following, alive, teamId, compact = false, className = '', onBack, onFollow, onSelectTeam }) {
  if (!back && !home && !canFollow) return null;
  const followLabel = following ? 'Following this team' : 'Follow this team';
  return (
    <div className={`squad-tools${className ? ` ${className}` : ''}`}>
      {back && <button type="button" className="fi-context-button fi-squad-back" onClick={() => onBack?.()}
        aria-label={compact ? back.label : undefined} title={compact ? back.label : undefined}>
        <Icon name="chevronLeft" size={16} />{compact ? null : back.label}
      </button>}
      {home && <button type="button" className="fi-context-button squad-tools__home" onClick={() => onSelectTeam?.(home.teamId)}>{home.label}</button>}
      {canFollow && <button type="button" className="fi-context-button fi-follow-team squad-tools__follow" aria-pressed={following}
        aria-label={compact ? followLabel : undefined} disabled={!alive} onClick={() => onFollow?.(teamId)}>
        {compact ? (following ? 'Following' : 'Follow') : followLabel}
      </button>}
    </div>
  );
}

/** The Formation / Starting five kicker (C§7.1): title + "4-4-2 · ● claimed". */
function FormationKicker({ id, title, aside }) {
  return (
    <h2 className="kicker squad-kicker">
      <span className="kicker__title" id={id}>{title}</span>
      {aside && <span className="kicker__aside">{aside}</span>}
    </h2>
  );
}

/** The starting lineup, in lineup order: the position column says what the group headings did. */
function SquadTable({ groups, notes }) {
  const rows = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  const paged = usePagedList(rows, { row: '.squad-row' });
  return (
    <div className="squad-list">
      <div className="squad-list__box" ref={paged.boxRef}>
        <div className="squad-table" role="table" aria-label="Starting lineup">
          <SquadTableHead />
          {paged.shown.map(row => <SquadRow key={row.key} row={row} />)}
        </div>
      </div>
      <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Lineup pages" className="squad-list__pager" />
      {notes.map(note => <p key={note} className="squad-note">{note}</p>)}
    </div>
  );
}

/** Everyone outside the lineup, as many as fit; nothing at all while there is no one. */
function SquadDepth({ depth }) {
  const rows = depth?.all || [];
  const paged = usePagedList(rows, { row: '.squad-row' });
  if (!rows.length) return null;
  return (
    <section className="squad-depth" aria-labelledby="squad-depth-title">
      <h2 className="kicker squad-kicker">
        <span className="kicker__title" id="squad-depth-title">Squad depth</span>
        <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label="Squad depth pages" />
        <span className="kicker__aside">{rows.length}</span>
      </h2>
      <div className="squad-depth__box" ref={paged.boxRef}>
        <div className="squad-table squad-table--depth" role="table" aria-labelledby="squad-depth-title">
          <SquadTableHead hidden />
          {paged.shown.map(row => <SquadRow key={row.key} row={row} />)}
        </div>
      </div>
    </section>
  );
}

function PitchPanel({ pitch, layout, formationTitle, formationAside, pitchLabel }) {
  return (
    <div className="squad-pitch-panel">
      <section className="squad-formation squad-formation--large" aria-labelledby="squad-formation-title">
        <FormationKicker id="squad-formation-title" title={formationTitle} aside={formationAside} />
        <SquadPitch slots={pitch} layout={layout} size="large" label={pitchLabel} />
      </section>
    </div>
  );
}

/** The phone's list: one line a player, one tab at a time, paged to what fits. */
function PhoneList({ rows, notes, label }) {
  const paged = usePagedList(rows, { row: '.squad-prow' });
  return (
    <div className="squad-phone__list">
      <div className="squad-phone__box" ref={paged.boxRef}>
        <ul className="squad-plist__rows" aria-label={label}>{paged.shown.map(row => <SquadPhoneRow key={row.key} row={row} />)}</ul>
      </div>
      <Pager page={paged.page} pages={paged.pages} onPage={paged.setPage} label={`${label} pages`} className="squad-list__pager" />
      {notes.map(note => <p key={note} className="squad-note">{note}</p>)}
    </div>
  );
}

function PhonePanel({ tab, groups, depth, pitch, layout, formationTitle, formationAside, pitchLabel, notes }) {
  const bench = depth?.all || [];
  const starters = useMemo(() => groups.flatMap(group => group.rows), [groups]);
  return (
    <div className="squad-phone" id="squad-phone-panel">
      {tab === 'pitch'
        ? <section className="squad-formation squad-formation--phone" aria-labelledby="squad-pformation-title">
          <FormationKicker id="squad-pformation-title" title={formationTitle} aside={formationAside} />
          <SquadPitch slots={pitch} layout={layout} size="phone" label={pitchLabel} />
        </section>
        : tab === 'bench' ? <PhoneList key="bench" rows={bench} notes={[]} label="Squad depth" />
          : <PhoneList key="starters" rows={starters} notes={notes} label="Starting lineup" />}
    </div>
  );
}

/** Model: buildSquad() (C§16, PLAN §3.5) + FROZEN callbacks onFollow, onBack, onSelectTeam. */
export default function SquadScreen({
  teamId = null, team = null, name = '', layout = 'pitch', kicker = '', xi = null, claimedCount = 0,
  formation = '', formationAside = '', viewLabel = 'Pitch', formationTitle = 'Formation', pitchLabel = null,
  groups = [], depth = null, pitch = [], profile = [],
  profileScale = 'Scale 60–95', acquisitions = null, status = 'alive', statusLabel = null,
  canFollow = false, following = false, back = null, home = null, notes = [],
  onFollow, onBack, onSelectTeam,
}) {
  const [tab, setTab] = useState('list');
  const hasBench = !!depth?.all?.length;
  // The bench is a phone tab; beside the list, a wider window shows it anyway.
  const phoneTab = tab === 'pitch' ? 'pitch' : tab === 'bench' && hasBench ? 'bench' : 'list';
  const mainTab = tab === 'bench' ? 'list' : tab;
  const alive = status !== 'fallen';
  const tabs = [['list', 'List'], ['pitch', viewLabel], ['acquisitions', 'Acquisitions']];
  const phoneTabs = [['list', 'List'], ['pitch', viewLabel], ...(hasBench ? [['bench', 'Bench']] : [])];
  const shape = { pitch, layout, formationTitle, formationAside, pitchLabel: pitchLabel || `${formationTitle} ${formation}`.trim() };

  function onKeyDown(event) {
    if (event.key === 'Escape' && onBack && !event.defaultPrevented) {
      event.preventDefault();
      onBack();
    }
  }
  function onTabKey(event, index) {
    const last = tabs.length - 1;
    const next = event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
      : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
    if (next == null) return;
    event.preventDefault();
    setTab(tabs[next][0]);
    event.currentTarget.parentElement?.children[next]?.focus();
  }

  const root = { id: 'view-panel-squad', className: 'screen screen--squad', 'aria-labelledby': 'view-tab-squad', tabIndex: -1, onKeyDown };
  if (!teamId) {
    // No team chosen yet (or the model is still the W1 stub): keep a way back whenever App passes onBack.
    return (
      <section {...root} data-empty="true">
        {onBack && <Tools back={{ label: back?.label || 'Back to map' }} className="squad-tools--empty" onBack={onBack} />}
        <p className="squad-empty squad-empty--screen">Select a team on the map or in the standings.</p>
      </section>
    );
  }
  const tools = { back, home, canFollow, following, alive, teamId, onBack, onFollow, onSelectTeam };
  const mark = team ? <TeamMark id={team.flagId} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub} width={48} height={36} /> : null;
  const phoneMark = team ? <TeamMark id={team.flagId} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub} width={32} height={24} /> : null;

  return (
    <section {...root} data-tab={mainTab} data-layout={layout}>
      <header className="squad-head">
        <span className="squad-head__flag" aria-hidden="true">{mark}</span>
        <div className="squad-head__title">
          <h1 className="squad-head__name" title={kicker ? `${name} · ${kicker}` : name}>{name}</h1>
          {statusLabel && <p className="squad-head__status">{statusLabel}</p>}
        </div>
        <div className="squad-tabs" role="tablist" aria-label="Squad views">
          {tabs.map(([id, label], i) => (
            <button key={id} type="button" role="tab" id={`squad-tab-${id}`} className="squad-tab" aria-selected={mainTab === id}
              aria-controls="squad-tabpanel" tabIndex={mainTab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => onTabKey(event, i)}>
              {label}
            </button>
          ))}
        </div>
        <dl className="squad-head__stats">
          <div className="squad-head__stat">
            <dt className="squad-head__label">{xi?.label || 'Starting XI'}</dt>
            <dd className="squad-head__value">{xi?.value}{xi?.delta && <> <span className={`squad-head__delta tone-${xi.tone || 'muted'}`}>{xi.delta}</span></>}</dd>
          </div>
          <div className="squad-head__stat">
            <dt className="squad-head__label">Claimed</dt>
            <dd className="squad-head__value squad-head__value--claimed">{claimedCount}</dd>
          </div>
        </dl>
        <Tools {...tools} />
      </header>
      <header className="squad-mhead">
        <div className="squad-mhead__row">
          <span className="squad-mhead__flag" aria-hidden="true">{phoneMark}</span>
          <h1 className="squad-mhead__name" title={name}>{name}</h1>
          <span className="squad-mhead__xi">{xi?.short || 'XI'} {xi?.value}</span>
        </div>
        <div className="squad-mhead__line">
          {statusLabel && <p className="squad-mhead__meta"><span className="squad-head__status">{statusLabel}</span></p>}
          <Tools {...tools} compact />
        </div>
      </header>
      <div className="segmented squad-seg" role="group" aria-label="Squad view">
        {phoneTabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={phoneTab === id} aria-controls="squad-phone-panel" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="squad-body">
        <div className="squad-main" id="squad-tabpanel" role="tabpanel" aria-labelledby={`squad-tab-${mainTab}`}>
          {mainTab === 'list' && <SquadTable groups={groups} notes={notes} />}
          {mainTab === 'pitch' && <PitchPanel {...shape} />}
          {mainTab === 'acquisitions' && <SquadAcquisitions acquisitions={acquisitions} />}
        </div>
        <aside className="squad-side" aria-label="Squad summary" data-tab={mainTab}>
          <StrengthProfile rows={profile} scale={profileScale} />
          {mainTab !== 'acquisitions' && <SquadDepth depth={depth} />}
        </aside>
        <PhonePanel tab={phoneTab} groups={groups} depth={depth} notes={notes} {...shape} />
      </div>
    </section>
  );
}
