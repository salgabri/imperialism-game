// Owner: WP-SQUAD (see PLAN.md §4). The Squad view (boards C1/C2, A-4 breakpoints, C§12 tab proposals).
// Presentational: the model comes from buildSquad(st, ctx, teamId) (src/viewModels/squad.js); the only local
// state is the List / Pitch / Acquisitions tab and the expanded depth list (UI-only, never saved).
import React, { useState } from 'react';
import TeamMark from '../../components/TeamMark.jsx';
import Icon from '../../components/Icon.jsx';
import SquadRow, { SquadTableHead } from './SquadRow.jsx';
import SquadPhoneRow from './SquadPhoneRow.jsx';
import SquadPitch from './SquadPitch.jsx';
import StrengthProfile from './StrengthProfile.jsx';
import ClaimedList from './ClaimedList.jsx';
import SquadAcquisitions from './SquadAcquisitions.jsx';
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

function DepthKicker({ depth, open, onToggle, id }) {
  return (
    <h2 className="kicker squad-kicker">
      <span className="kicker__title" id={id}>Squad depth</span>
      {depth?.more && <button type="button" className="kicker__aside squad-depth__more" aria-expanded={open} onClick={onToggle}>
        {open ? 'Show fewer' : depth.more}
      </button>}
    </h2>
  );
}

function SquadTable({ groups, depth, showSource, depthOpen, onToggleDepth, notes }) {
  const depthRows = depthOpen ? depth?.all || [] : depth?.rows || [];
  const columns = showSource ? 8 : 7;
  return (
    <div className="squad-list">
      <div className="squad-table" role="table" aria-label="Starting lineup" data-source={showSource ? 'true' : 'false'}>
        <SquadTableHead showSource={showSource} />
        {groups.map(group => (
          <div key={group.key || group.label} className="squad-table__group" role="rowgroup">
            <div className="squad-group" role="row"><span role="rowheader" aria-colspan={columns}>{group.label}</span></div>
            {group.rows.map(row => <SquadRow key={row.key} row={row} showSource={showSource} />)}
          </div>
        ))}
      </div>
      <section className="squad-depth" aria-labelledby="squad-depth-title">
        <DepthKicker depth={depth} open={depthOpen} onToggle={onToggleDepth} id="squad-depth-title" />
        {depthRows.length ? (
          <div className="squad-table squad-table--depth" role="table" aria-labelledby="squad-depth-title" data-source={showSource ? 'true' : 'false'}>
            <SquadTableHead showSource={showSource} hidden />
            {depthRows.map(row => <SquadRow key={row.key} row={row} showSource={showSource} />)}
          </div>
        ) : <p className="squad-empty">No reserve players yet.</p>}
      </section>
      {notes.map(note => <p key={note} className="squad-note">{note}</p>)}
    </div>
  );
}

function PitchPanel({ pitch, layout, formationTitle, formationAside, pitchLabel, depth }) {
  const bench = depth?.all || [];
  return (
    <div className="squad-pitch-panel">
      <section className="squad-formation squad-formation--large" aria-labelledby="squad-formation-title">
        <FormationKicker id="squad-formation-title" title={formationTitle} aside={formationAside} />
        <SquadPitch slots={pitch} layout={layout} size="large" label={pitchLabel} />
      </section>
      <section className="squad-depth" aria-labelledby="squad-bench-title">
        <h2 className="kicker squad-kicker">
          <span className="kicker__title" id="squad-bench-title">Squad depth</span>
          <span className="kicker__aside">{bench.length === 1 ? '1 player' : `${bench.length} players`}</span>
        </h2>
        {bench.length ? (
          <ul className="squad-chips">
            {bench.map(row => (
              <li key={row.key} className={`squad-chip${row.acquired ? ' is-claimed' : ''}`} title={row.fullName || row.name}>
                <span className="squad-chip__pos">{row.pos}</span> · <span className="squad-chip__name">{row.short || row.name}</span>
                {' · '}<span className="squad-chip__rating squad-tier" data-tier={row.tier}>{row.rating}</span>
              </li>
            ))}
          </ul>
        ) : <p className="squad-empty">No reserve players yet.</p>}
      </section>
    </div>
  );
}

function PhoneGroup({ label, rows, id }) {
  return (
    <section className="squad-plist__group" aria-labelledby={id}>
      <h3 className="squad-plist__head" id={id}>{label}</h3>
      <ul className="squad-plist__rows">{rows.map(row => <SquadPhoneRow key={row.key} row={row} />)}</ul>
    </section>
  );
}

function PhonePanel({ tab, groups, depth, pitch, layout, formationTitle, formationAside, pitchLabel, notes }) {
  const bench = depth?.all || [];
  return (
    <div className="squad-phone" id="squad-phone-panel">
      {tab === 'pitch'
        ? <section className="squad-formation squad-formation--phone" aria-labelledby="squad-pformation-title">
          <FormationKicker id="squad-pformation-title" title={formationTitle} aside={formationAside} />
          <SquadPitch slots={pitch} layout={layout} size="phone" label={pitchLabel} />
        </section>
        : groups.map((group, i) => <PhoneGroup key={group.key || group.label} id={`squad-pgroup-${i}`} label={group.label} rows={group.rows} />)}
      {bench.length > 0 && <PhoneGroup id="squad-pgroup-depth" label="Squad depth" rows={bench} />}
      {notes.map(note => <p key={note} className="squad-note">{note}</p>)}
    </div>
  );
}

/** Model: buildSquad() (C§16, PLAN §3.5) + FROZEN callbacks onFollow, onBack, onSelectTeam. */
export default function SquadScreen({
  teamId = null, team = null, name = '', layout = 'pitch', kicker = '', phoneMeta = '', xi = null, claimedCount = 0,
  formation = '', formationAside = '', viewLabel = 'Pitch', formationTitle = 'Formation', pitchLabel = null,
  groups = [], depth = null, showSource = true, pitch = [], profile = [],
  profileScale = 'Scale 60–95', claimed = [], acquisitions = null, status = 'alive', statusLabel = null,
  canFollow = false, following = false, back = null, home = null, notes = [],
  onFollow, onBack, onSelectTeam,
}) {
  const [tab, setTab] = useState('list');
  const [depthOpen, setDepthOpen] = useState(false);
  const phoneTab = tab === 'pitch' ? 'pitch' : 'list';
  const alive = status !== 'fallen';
  const tabs = [['list', 'List'], ['pitch', viewLabel], ['acquisitions', 'Acquisitions']];
  const phoneTabs = tabs.slice(0, 2);
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
        <p className="squad-empty squad-empty--screen">Select a team on the map or in the standings to inspect its squad.</p>
      </section>
    );
  }
  const tools = { back, home, canFollow, following, alive, teamId, onBack, onFollow, onSelectTeam };
  const mark = team ? <TeamMark id={team.flagId} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub} width={48} height={36} /> : null;
  const phoneMark = team ? <TeamMark id={team.flagId} teamId={team.teamId} code={team.code} color={team.color} isClub={team.isClub} width={32} height={24} /> : null;

  return (
    <section {...root} data-tab={tab} data-layout={layout}>
      <header className="squad-head">
        <span className="squad-head__flag" aria-hidden="true">{mark}</span>
        <div className="squad-head__title">
          <p className="squad-head__kicker">
            {kicker}
            {statusLabel && <span className="squad-head__status"> · {statusLabel}</span>}
          </p>
          <h1 className="squad-head__name" title={name}>{name}</h1>
        </div>
        <div className="squad-tabs" role="tablist" aria-label="Squad views">
          {tabs.map(([id, label], i) => (
            <button key={id} type="button" role="tab" id={`squad-tab-${id}`} className="squad-tab" aria-selected={tab === id}
              aria-controls="squad-tabpanel" tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => onTabKey(event, i)}>
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
          <p className="squad-mhead__meta">
            {phoneMeta}
            {statusLabel && <span className="squad-head__status"> · {statusLabel}</span>}
          </p>
          <Tools {...tools} compact />
        </div>
      </header>
      <div className="segmented squad-seg" role="group" aria-label="Squad view">
        {phoneTabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={phoneTab === id} aria-controls="squad-phone-panel" onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="squad-body">
        <div className="squad-main" id="squad-tabpanel" role="tabpanel" aria-labelledby={`squad-tab-${tab}`}>
          {tab === 'list' && <SquadTable groups={groups} depth={depth} showSource={showSource} depthOpen={depthOpen}
            onToggleDepth={() => setDepthOpen(open => !open)} notes={notes} />}
          {tab === 'pitch' && <PitchPanel {...shape} depth={depth} />}
          {tab === 'acquisitions' && <SquadAcquisitions acquisitions={acquisitions} />}
        </div>
        <aside className="squad-side" aria-label="Squad summary" data-tab={tab}>
          {tab !== 'pitch' && <section className="squad-formation" aria-labelledby="squad-formation-title">
            <FormationKicker id="squad-formation-title" title={formationTitle} aside={formationAside} />
            <SquadPitch slots={pitch} layout={layout} size="side" label={shape.pitchLabel} />
          </section>}
          <StrengthProfile rows={profile} scale={profileScale} />
          {tab !== 'acquisitions' && <ClaimedList rows={claimed} />}
        </aside>
        <PhonePanel tab={phoneTab} groups={groups} depth={depth} notes={notes} {...shape} />
      </div>
    </section>
  );
}
